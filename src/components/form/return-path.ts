/**
 * 登録後の遷移先。端末詳細・社員詳細から開いた画面は、フォームで最終的に選ばれた
 * 端末 (社員) の詳細画面へ戻す (開いた後に対象を選び直した場合に別の端末へ戻らないように)。
 */
export function returnPath(returnTo: string | undefined, fallback: string, ids: { deviceId?: number; employeeId?: number }) {
  if (returnTo?.startsWith("/devices/") && ids.deviceId) return `/devices/${ids.deviceId}`;
  if (returnTo?.startsWith("/employees/") && ids.employeeId) return `/employees/${ids.employeeId}`;
  return returnTo ?? fallback;
}
