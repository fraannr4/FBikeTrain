import { memo, useEffect, useRef, useState } from 'react';
import type { CircleMarker, LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../../domain/types';
import { useReducedMotion } from '../theme/motion';
import { mapOptions } from './mapOptions';

export const CYCLOSM_URL = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
export const CYCLOSM_ATTRIBUTION =
  '<a href="https://www.cyclosm.org">CyclOSM</a> | Datos: &copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>';

/** Subida pintada sobre el trazado: su tramo, su número y la clase de pendiente (0-5, `--g0`...`--g5`). */
export type MapClimb = { n: number; cls: number; path: LatLng[] };
/** Tramo calculado por carretera encima del trazado (empalmes): conector de unión o de regreso. */
export type MapOverlay = { path: LatLng[]; kind: 'connector' | 'return' };

type Props = {
  points: LatLng[];
  /** Nombre de la región del mapa. */
  label: string;
  /** Subidas numeradas: el tramo coloreado y una chincheta en su cima. */
  climbs?: MapClimb[];
  /** Conectores pintados en otro color sobre el trazado. */
  overlays?: MapOverlay[];
  /** Punto que sigue al dedo en el perfil; `null` lo oculta. */
  cursor?: LatLng | null;
  /**
   * Con `false`, el mapa no se arrastra ni se amplía (cabecera de Salida: el dedo desplaza la página)
   * y la atribución va en una placa propia. Por defecto se puede mover, con el zoom de Leaflet.
   */
  interactive?: boolean;
  /** Atribución de Leaflet con sus enlaces; por defecto, solo en el mapa que se mueve. */
  attribution?: boolean;
  /** Margen vertical (px) al encuadrar el trazado; por defecto 24, o 64 en el mapa estático. */
  fitPadding?: number;
  className?: string;
};

type Leaflet = typeof import('leaflet');
type Api = { L: Leaflet; map: LeafletMap; cur: CircleMarker; climbs: LayerGroup; pins: LayerGroup };

/** Chinchetas a menos de esto (px) se funden en una («2·3»), con el color de la más dura. */
const PIN_MERGE_PX = 24;

/**
 * Mapa de Leaflet con las teselas de CyclOSM, el trazado con halo, el punto de salida y, si se dan, las
 * subidas numeradas y el cursor del perfil. Leaflet se carga aparte, solo cuando hay un mapa que pintar.
 * El mapa se crea una vez por trazado; subidas y cursor se actualizan encima. Los colores salen de los
 * tokens por clase CSS, así que siguen al tema sin repintar.
 */
export const RideMap = memo(function RideMap({
  points,
  label,
  climbs,
  overlays,
  cursor = null,
  interactive = true,
  attribution = interactive,
  fitPadding,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const api = useRef<Api | null>(null);
  const climbsRef = useRef(climbs);
  climbsRef.current = climbs;
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;
    import('leaflet').then((L) => {
      const node = ref.current;
      // Sin SVG (jsdom) Leaflet no tiene con qué pintar el trazado: la región queda vacía.
      if (cancelled || !node || points.length < 2 || !L.Browser.svg) return;
      const m = L.map(node, {
        ...mapOptions(reduced, !interactive),
        attributionControl: attribution,
        touchZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        zoomSnap: 0.25,
      });
      m.attributionControl?.setPrefix(false);
      if (interactive) L.control.zoom({ zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(m);
      // Atenuación del fondo entre las teselas (200) y los trazados (400).
      const tint = m.createPane('tint');
      tint.style.zIndex = '250';
      L.DomUtil.create('div', 'map-tint', tint);
      L.tileLayer(CYCLOSM_URL, { subdomains: 'abc', maxZoom: 20, attribution: CYCLOSM_ATTRIBUTION }).addTo(m);
      const line = points.map((p) => [p.lat, p.lng] as [number, number]);
      const bounds = L.latLngBounds(line);
      // Sin tamaño (aún no se ve) no se puede encuadrar: una vista provisional y se encuadra al medirse.
      const fit = () => {
        m.invalidateSize();
        // Estático (cabecera): margen extra arriba y abajo para que la flecha de volver, la placa de
        // atribución y el degradado no tapen el trazado ni las chinchetas.
        const pad = fitPadding ?? (interactive ? 24 : 64);
        if (node.clientWidth > 0 && node.clientHeight > 0)
          m.fitBounds(bounds, { paddingTopLeft: [24, pad], paddingBottomRight: [24, pad], animate: false });
        else m.setView(line[0], 13, { animate: false });
      };
      fit();
      if (interactive) {
        const FitControl = L.Control.extend({
          onAdd: () => {
            const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control-fit');
            const button = L.DomUtil.create('button', '', box);
            button.type = 'button';
            button.textContent = '⤢';
            button.title = 'Encuadrar ruta';
            button.setAttribute('aria-label', 'Encuadrar ruta');
            L.DomEvent.disableClickPropagation(box);
            L.DomEvent.disableScrollPropagation(box);
            L.DomEvent.on(button, 'click', fit);
            return box;
          },
        });
        new FitControl({ position: 'topleft' }).addTo(m);
      }
      L.polyline(line, { className: 'rmap-halo', interactive: false }).addTo(m);
      L.polyline(line, { className: 'rmap-core', interactive: false }).addTo(m);
      L.polyline(line, { className: 'rmap-thread', interactive: false }).addTo(m);
      // El SVG del trazado es decorativo: la región ya tiene nombre y las cifras van aparte.
      m.getPanes().overlayPane.querySelector('svg')?.setAttribute('aria-hidden', 'true');
      const climbLayer = L.layerGroup().addTo(m);
      L.circleMarker(line[0], { radius: 6, className: 'rmap-start', interactive: false }).addTo(m);
      const pins = L.layerGroup().addTo(m);
      const cur = L.circleMarker(line[0], { radius: 7, className: 'rmap-cur', interactive: false });
      const a: Api = { L, map: m, cur, climbs: climbLayer, pins };
      m.on('zoomend', () => drawPins(a, climbsRef.current));

      let timer: ReturnType<typeof setTimeout> | undefined;
      const ro =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => {
              clearTimeout(timer);
              timer = setTimeout(fit, 60);
            })
          : null;
      ro?.observe(node);
      api.current = a;
      setReady((n) => n + 1);
      teardown = () => {
        clearTimeout(timer);
        ro?.disconnect();
        api.current = null;
        m.remove();
      };
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [points, interactive, attribution, fitPadding, reduced]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.climbs.clearLayers();
    for (const c of climbs ?? []) {
      if (c.path.length < 2) continue;
      a.L.polyline(
        c.path.map((p) => [p.lat, p.lng] as [number, number]),
        { className: `rmap-climb rmap-g${c.cls}`, interactive: false },
      ).addTo(a.climbs);
    }
    for (const o of overlays ?? []) {
      if (o.path.length < 2) continue;
      a.L.polyline(
        o.path.map((p) => [p.lat, p.lng] as [number, number]),
        { className: `rmap-connector${o.kind === 'return' ? ' rmap-connector--return' : ''}`, interactive: false },
      ).addTo(a.climbs);
    }
    drawPins(a, climbs);
  }, [climbs, overlays, ready]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (!cursor) {
      a.cur.remove();
      return;
    }
    a.cur.setLatLng([cursor.lat, cursor.lng]);
    if (!a.map.hasLayer(a.cur)) a.cur.addTo(a.map);
  }, [cursor, ready]);

  const cls = ['rmap', className ?? 'ride-map', interactive ? '' : 'rmap--static'].filter(Boolean).join(' ');
  return <div ref={ref} className={cls} role="region" aria-label={label} />;
});

/** Una chincheta numerada en la cima de cada subida; las que se tocarían, fundidas en una. */
function drawPins(a: Api, climbs: MapClimb[] | undefined) {
  a.pins.clearLayers();
  const groups: { at: LatLng; x: number; y: number; n: number[]; cls: number }[] = [];
  for (const c of climbs ?? []) {
    const top = c.path[c.path.length - 1];
    if (!top) continue;
    const pt = a.map.latLngToContainerPoint([top.lat, top.lng]);
    const g = groups.find((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < PIN_MERGE_PX);
    if (g) {
      g.n.push(c.n);
      g.cls = Math.max(g.cls, c.cls);
    } else groups.push({ at: top, x: pt.x, y: pt.y, n: [c.n], cls: c.cls });
  }
  for (const g of groups) {
    const text = g.n.join('·');
    const w = g.n.length === 1 ? 24 : 12 + text.length * 8;
    const icon = a.L.divIcon({
      className: 'rmap-pin-box',
      html: `<span class="rmap-pin rmap-g${g.cls}">${text}</span>`,
      iconSize: [w, 24],
      iconAnchor: [w / 2, 12],
    });
    a.L.marker([g.at.lat, g.at.lng], { icon, interactive: false, keyboard: false }).addTo(a.pins);
  }
}
