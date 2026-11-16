-- Retira el índice antiguo de Ride with GPS: la biblioteca común (`reference_routes`, migración
-- 202611160001) lo sustituye y la operación `nearby` de la función `rwgps` ya no existe.
-- Se queda `rwgps_sync_state`: es el reloj de la sincronización de la biblioteca.
-- Se aplica la última, cuando `reference_routes` ya tenga las rutas de la sincronización.
drop function public.rwgps_routes_near(double precision, double precision, double precision);
drop table public.rwgps_route_index;
