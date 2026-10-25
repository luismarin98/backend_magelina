/** Solo rutas locales conocidas; nunca se utiliza una URL arbitraria del navegador. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || /[^a-z0-9/]/i.test(value)) return '/dashboard';
  const path = value.replace(/\/+$/, '');
  if (/^\/dashboard$/.test(path) || /^\/admin(?:\/(?:servers|operations))?$/.test(path) ||
      /^\/dashboard\/servers\/\d{17,20}(?:\/(?:tasks|knowledge|projects|collaboration|automations|audit|roles|settings|permissions))?$/.test(path)) return path;
  return '/dashboard';
}
