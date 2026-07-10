import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { WorkbenchApp } from './WorkbenchApp';

export const VIEW_TYPE = 'mengshi-workbench';

export class WorkbenchView extends ItemView {
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '猛士驾驶舱';
  }

  getIcon(): string {
    return 'mengshi-logo';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('mengshi-workbench-root');

    this.root = createRoot(container);
    this.root.render(React.createElement(WorkbenchApp, { app: this.app }));
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
