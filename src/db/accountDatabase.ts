export function accountDatabaseName(userId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Identidad de cuenta no válida');
  }
  return `ciclismo-user-${userId.toLowerCase()}`;
}
