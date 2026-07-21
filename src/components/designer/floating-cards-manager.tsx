'use client';

import { useDesignerStore } from '@/store/designer-store';
import { FloatingCard } from './floating-card';
import { useCallback } from 'react';

interface FloatingCardsManagerProps {
  boundsRef?: React.RefObject<HTMLDivElement | null>;
}

export function FloatingCardsManager({ boundsRef }: FloatingCardsManagerProps) {
  const floatingCards = useDesignerStore((s) => s.floatingCards);
  const findElementById = useDesignerStore((s) => s.findElementById);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  // Subscribe to elements to trigger re-renders when element data changes
  // (e.g. property updates on group children). findElementById alone doesn't
  // cause re-renders because its function reference is stable.
  useDesignerStore((s) => s.elements);

  // Find the currently selected element (supports group children via findElementById)
  const selectedElement = selectedElementIds.length > 0
    ? findElementById(selectedElementIds[0])
    : null;

  const handleBringToFront = useCallback((cardId: string) => {
    const state = useDesignerStore.getState();
    const maxZ = Math.max(...state.floatingCards.map(c => c.zIndex), 0);
    useDesignerStore.setState({
      floatingCards: state.floatingCards.map(c =>
        c.id === cardId ? { ...c, zIndex: maxZ + 1 } : c
      ),
    });
  }, []);

  // Don't render if no element selected or no floating cards exist
  // Floating cards can exist in ANY display mode since Shift+S works universally (Recommendation 10)
  if (!selectedElement || floatingCards.length === 0) return null;

  // When multiple elements are selected, pass the full selection list so
  // shared sections (Alignment, Opacity) can apply to all of them.
  const multiSelectIds = selectedElementIds.length > 1 ? selectedElementIds : undefined;

  return (
    <>
      {floatingCards.map(card => (
        <FloatingCard
          key={card.id}
          card={card}
          element={selectedElement}
          multiSelectIds={multiSelectIds}
          onBringToFront={handleBringToFront}
          boundsRef={boundsRef}
        />
      ))}
    </>
  );
}
