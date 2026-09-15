import { ComponentType, ReactNode } from 'react';

export interface BlackBoxProviderProps {
  children: ReactNode;
  /** Custom fallback UI to show when an error is caught */
  fallback?: ReactNode;
}

/** Floating debug panel. Renders nothing (no launcher, no Ctrl/Cmd+Shift+B
 *  shortcut) until blackbox.init() has enabled BlackBox. Render it as a
 *  sibling OUTSIDE <BlackBoxProvider>: on a render crash the provider replaces
 *  its children with the fallback, which would unmount a nested panel. */
export declare const BlackBoxPanel: ComponentType<{}>;

/** Error boundary. Render crashes are recorded with `source: 'react_boundary'`
 *  (only when init() enabled BlackBox), then `fallback` (or a default
 *  "Something went wrong." + Try Again) is shown in place of the children. */
export declare const BlackBoxProvider: ComponentType<BlackBoxProviderProps>;
