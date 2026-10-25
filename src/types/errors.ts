export function hasCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido.';
}
