import { ParseError } from '../src/domain/types';

/** Comprueba que `fn` lanza un ParseError con ese `reason`. */
export function expectParseError(fn: () => unknown, reason: ParseError['reason']): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    expect((e as ParseError).reason).toBe(reason);
    return;
  }
  throw new Error('se esperaba ParseError');
}
