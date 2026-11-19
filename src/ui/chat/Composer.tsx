import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp } from '../icons';
import { clampMessage, counterText } from './model';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const autoGrows = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

/**
 * Campo de texto del chat: crece hasta 5 líneas, contador al pasar de 1800 caracteres y enviar apagado
 * con el campo vacío. En escritorio, Intro envía y Mayús+Intro salta de línea; en táctil, Intro salta.
 * Al enviar se vacía en el acto: un segundo toque ya no tiene nada que mandar.
 */
export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const counterId = `${useId()}-count`;
  const counter = counterText(text);
  const empty = !text.trim();

  // Sin `field-sizing`, la altura se ajusta a mano; el tope de 5 líneas lo pone el CSS.
  useLayoutEffect(() => {
    const box = ref.current;
    if (autoGrows || !box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }, [text]);

  const send = () => {
    if (empty) return;
    onSend(text.trim());
    setText('');
    // El toque en «Enviar» se lleva el foco; devolverlo deja abierto el teclado del móvil.
    ref.current?.focus();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (typeof window.matchMedia !== 'function' || !window.matchMedia(FINE_POINTER).matches) return;
    e.preventDefault();
    send();
  };

  return (
    <form className="chat-composer chat-composer--plain" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor={`${counterId}-in`}>Mensaje</label>
      <textarea
        ref={ref}
        id={`${counterId}-in`}
        className="chat-input"
        rows={1}
        placeholder="Mensaje"
        value={text}
        enterKeyHint="send"
        aria-describedby={counter ? counterId : undefined}
        onChange={(e) => setText(clampMessage(e.target.value))}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="chat-send" aria-label="Enviar" disabled={empty}>
        <ArrowUp className="ic" aria-hidden="true" />
      </button>
      {counter ? <span className="chat-counter" id={counterId}>{counter}</span> : null}
    </form>
  );
}
