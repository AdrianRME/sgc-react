import { createContext, useContext } from 'react';

/** Contexto del estado de la app (lo provee StoreProvider). */
export const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);
