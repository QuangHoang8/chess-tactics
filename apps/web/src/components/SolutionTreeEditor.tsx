import { useState } from "react";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import { applyMove, type MoveInput } from "@chess-tactics/domain";
import { childrenOf, nextActorAfter, type EditorNode } from "../lib/chess-ui";
import { PromotionPicker } from "./PromotionPicker";

interface SolutionTreeEditorProps {
  rootFen: string;
  nodes: EditorNode[];
  onNodesChange: (nodes: EditorNode[]) => void;
}

interface PendingPromotion {
  from: string;
  to: string;
}

export function SolutionTreeEditor({ rootFen, nodes, onNodesChange }: SolutionTreeEditorProps) {
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const currentNode = currentNodeId ? (nodes.find((n) => n.id === currentNodeId) ?? null) : null;
  const currentFen = currentNode ? currentNode.fen : rootFen;
  const boardOrientation = rootFen.split(/\s+/)[1] === "b" ? "black" : "white";

  function playMove(move: MoveInput): boolean {
    const applied = applyMove(currentFen, move);
    if (!applied.ok) {
      setRejected(applied.error);
      return false;
    }
    setRejected(null);

    const siblings = childrenOf(nodes, currentNodeId);
    const existing = siblings.find((s) => s.san === applied.san);
    if (existing) {
      // Playing a move that already exists at this branch point just navigates into it --
      // there's no DB uniqueness on (parentId, san), so creating a second node here would be an
      // unreachable duplicate the server/training code never deduplicates.
      setCurrentNodeId(existing.id);
      return true;
    }

    const node: EditorNode = {
      id: crypto.randomUUID(),
      parentId: currentNodeId,
      san: applied.san,
      // Actor is always derived from depth, never chosen -- the server assumes strict
      // alternation (training.service.ts) but never validates it.
      actor: nextActorAfter(currentNode ?? undefined),
      isPrimary: siblings.length === 0,
      comment: "",
      fen: applied.fen,
    };
    onNodesChange([...nodes, node]);
    setCurrentNodeId(node.id);
    return true;
  }

  function handlePieceDrop({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) {
      return false;
    }
    const isPromotion = piece.pieceType.endsWith("P") && (targetSquare.endsWith("8") || targetSquare.endsWith("1"));
    if (isPromotion) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      return false;
    }
    return playMove({ from: sourceSquare, to: targetSquare });
  }

  function handlePromotionSelect(promotion: "q" | "r" | "b" | "n"): void {
    if (!pendingPromotion) {
      return;
    }
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    playMove({ from, to, promotion });
  }

  function setPrimary(nodeId: string): void {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }
    onNodesChange(nodes.map((n) => (n.parentId === node.parentId ? { ...n, isPrimary: n.id === nodeId } : n)));
  }

  function updateComment(nodeId: string, comment: string): void {
    onNodesChange(nodes.map((n) => (n.id === nodeId ? { ...n, comment } : n)));
  }

  function deleteSubtree(nodeId: string): void {
    const toRemove = collectSubtreeIds(nodes, nodeId);
    const removedNode = nodes.find((n) => n.id === nodeId);
    let remaining = nodes.filter((n) => !toRemove.has(n.id));

    // Keep the exactly-one-primary-per-sibling-group invariant: training.service.ts does
    // `children.find(isPrimary) ?? children[0]`, so a group left with no primary silently falls
    // back to array order -- promote the first survivor instead of leaving that to chance.
    if (removedNode?.isPrimary) {
      const orphanedSiblings = remaining.filter((n) => n.parentId === removedNode.parentId);
      const firstSibling = orphanedSiblings[0];
      if (firstSibling && !orphanedSiblings.some((s) => s.isPrimary)) {
        remaining = remaining.map((n) => (n.id === firstSibling.id ? { ...n, isPrimary: true } : n));
      }
    }

    onNodesChange(remaining);
    if (currentNodeId !== null && toRemove.has(currentNodeId)) {
      setCurrentNodeId(removedNode?.parentId ?? null);
    }
  }

  return (
    <section className="solution-tree-editor">
      <div className="board-wrapper">
        <Chessboard options={{ position: currentFen, boardOrientation, onPieceDrop: handlePieceDrop }} />
      </div>
      {rejected && <p role="alert">{rejected}</p>}
      {pendingPromotion && (
        <PromotionPicker onSelect={handlePromotionSelect} onCancel={() => setPendingPromotion(null)} />
      )}

      <p>
        Playing from: {currentNode ? `${currentNode.san} (${currentNode.actor})` : "starting position"} -- drag a
        move on the board to extend the line, or play a different move than an existing child to create an
        alternative.
      </p>
      <button type="button" onClick={() => setCurrentNodeId(null)} disabled={currentNodeId === null}>
        Back to start
      </button>

      <TreeList
        nodes={nodes}
        parentId={null}
        currentNodeId={currentNodeId}
        onSelect={setCurrentNodeId}
        onSetPrimary={setPrimary}
        onDelete={deleteSubtree}
      />

      {currentNode && (
        <label className="comment-field">
          Comment on {currentNode.san}
          <textarea
            value={currentNode.comment}
            onChange={(event) => updateComment(currentNode.id, event.target.value)}
          />
        </label>
      )}
    </section>
  );
}

interface TreeListProps {
  nodes: EditorNode[];
  parentId: string | null;
  currentNodeId: string | null;
  onSelect: (id: string) => void;
  onSetPrimary: (id: string) => void;
  onDelete: (id: string) => void;
}

function TreeList({ nodes, parentId, currentNodeId, onSelect, onSetPrimary, onDelete }: TreeListProps) {
  const siblings = childrenOf(nodes, parentId);
  if (siblings.length === 0) {
    return null;
  }
  return (
    <ul className="solution-tree-list">
      {siblings.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            aria-current={node.id === currentNodeId}
          >
            {node.san}
            {node.actor === "OPPONENT" ? " (opponent)" : ""}
            {node.isPrimary ? "" : " (alternative)"}
          </button>
          {!node.isPrimary && (
            <button type="button" onClick={() => onSetPrimary(node.id)}>
              Set as main line
            </button>
          )}
          <button type="button" onClick={() => onDelete(node.id)}>
            Delete
          </button>
          <TreeList
            nodes={nodes}
            parentId={node.id}
            currentNodeId={currentNodeId}
            onSelect={onSelect}
            onSetPrimary={onSetPrimary}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

function collectSubtreeIds(nodes: EditorNode[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}
