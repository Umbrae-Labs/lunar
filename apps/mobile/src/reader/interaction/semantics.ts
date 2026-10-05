export type ReaderSemanticRole = 'heading' | 'paragraph' | 'link' | 'image' | 'list' | 'listitem';

export interface ReaderSemanticNode {
  readonly id: string;
  readonly role: ReaderSemanticRole;
  readonly label: string;
  readonly href?: string;
  readonly children: readonly ReaderSemanticNode[];
}

export interface ReaderSemanticsSnapshot {
  readonly revisionId: number;
  readonly spreadIndex: number;
  readonly nodes: readonly ReaderSemanticNode[];
}
