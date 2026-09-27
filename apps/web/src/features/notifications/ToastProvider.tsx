import { createContext, useContext, useState, type ReactNode } from 'react';
import { createToastStore, type ToastStore } from './toast-store.js';
import { Toasts } from './Toasts.js';

const ToastContext = createContext<ToastStore | null>(null);

/** One toast region for the workspace, rendered after its children. */
export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [store] = useState(createToastStore);
  return (
    <ToastContext.Provider value={store}>
      {children}
      <Toasts store={store} />
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastStore {
  const store = useContext(ToastContext);
  if (!store) throw new Error('useToasts must be used inside a ToastProvider');
  return store;
}
