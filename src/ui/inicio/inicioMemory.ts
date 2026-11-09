/**
 * Lo que Inicio recuerda mientras la app sigue abierta, para volver atrás (POP) sin perder el sitio:
 * la altura a la que se dejó cada entrada del historial (por `location.key`) y lo último que se leyó
 * de la base. Con esos datos la página se pinta entera al instante (sin el esqueleto, mucho más
 * corto, que haría perder la posición) y se relee la base por detrás.
 */
const views = new Map<string, number>();
let last: unknown = null;

export function rememberScroll(entry: string, y: number): void {
  views.set(entry, y);
}

export function savedScroll(entry: string): number | undefined {
  return views.get(entry);
}

export function rememberData<T>(data: T): T {
  last = data;
  return data;
}

export function lastData<T>(): T | null {
  return last as T | null;
}

/** Para las pruebas: cada una empieza sin nada recordado. */
export function resetInicioMemory(): void {
  views.clear();
  last = null;
}
