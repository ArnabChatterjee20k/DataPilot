import { create } from "zustand";

/**
 * The new-connection dialog, opened from more than one place.
 *
 * With nothing connected, adding a connection is the only useful thing on the
 * screen, so the empty state offers it too - not just the sidebar.
 */
interface DialogStore {
  editingConnectionId: string | null;
  isConnectionDialogOpen: boolean;
  openConnectionDialog: (connectionId?: string | null) => void;
  closeConnectionDialog: () => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  editingConnectionId: null,
  isConnectionDialogOpen: false,
  openConnectionDialog: (connectionId = null) =>
    set({ isConnectionDialogOpen: true, editingConnectionId: connectionId }),
  closeConnectionDialog: () =>
    set({ isConnectionDialogOpen: false, editingConnectionId: null }),
}));
