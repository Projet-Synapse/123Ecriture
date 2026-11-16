// Déclaration MINIMALE de react-dom (présent pour le web, sans @types/react-dom) :
// seul createPortal est utilisé — components/properties/SuggestionList.web.tsx.
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
