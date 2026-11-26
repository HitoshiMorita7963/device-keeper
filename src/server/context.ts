/** 業務処理 (src/server/*) に渡す操作者情報。操作履歴の記録に使う */
export type OperationContext = {
  user: { id: number };
  ipAddress: string | null;
};
