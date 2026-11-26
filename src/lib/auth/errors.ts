/** 未ログイン */
export class AuthenticationError extends Error {
  constructor(message = "ログインが必要です。") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** 権限不足 */
export class ForbiddenError extends Error {
  constructor(message = "この操作を行う権限がありません。") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** 業務ルール違反 (利用者にそのまま表示してよいメッセージを持つ) */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
