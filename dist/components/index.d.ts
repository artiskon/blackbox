import { ComponentType, ReactNode } from 'react';

export interface BlackBoxProviderProps {
  children: ReactNode;
  /** Custom fallback UI to show when an error is caught */
  fallback?: ReactNode;
}

export declare const BlackBoxPanel: ComponentType<{}>;
export declare const BlackBoxProvider: ComponentType<BlackBoxProviderProps>;
