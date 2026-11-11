# Fuentes externas: GPX del usuario y referencias de biblioteca

Fecha: 2026-11-11. Encargo aprobado en el chat; rama `codex/fuentes-externas`, worktree `C:\testTrain-fuentes-externas`, base `main` en `d346a15`. Sin commits, push, cambios en main ni despliegues.

1. Consultar fuentes oficiales actuales y redactar informe comparativo y correo de acceso a Wikiloc, sin enviarlo.
2. Auditar PWA ya fusionada: `codex/pwa-compartir` (`dd1d0a1`) es antecesora de main por `b489fc2`. No hay cambios exclusivos que rebasar/fusionar. Corregir recepción donde sea necesario en la rama nueva.
3. Conservar el envío hasta importación o descarte, con caducidad de 24 h; permitir elegir biblioteca/historial para GPX/TCX con tiempos. Verificar importación manual ya existente en biblioteca y aclarar instrucciones móviles.
4. Ejecutar T3 del plan de IA/biblioteca: conservar autor/enlace GPX, preferir referencias de biblioteca próximas, deduplicar y permitir fuente biblioteca. Solo nombre, fuente, km y desnivel al modelo. URL/autor/ubicación se quedan fuera del prompt. Sin automatización Wikiloc.
5. Posponer marcador opcional: la autorización de extracción de metadatos debe aclararse con Wikiloc; no es necesaria para GPX compartido/manual.
6. Verificar con Vitest, tipos, build, e2e de PWA, biblioteca e IA y capturas móviles en ambos temas. Revisión independiente de cumplimiento y calidad. Documentar límites y comprobaciones físicas Android, proponer commit.

El código sigue calculando las rutas nuevas con ORS; citar una referencia por sus cifras no equivale a seguir su trazado. La edición y Empalmar aprovechan la geometría local con las funciones existentes. El esquema compartido de `ai-routes` necesitará despliegue posterior para la fuente `biblioteca`; este encargo no lo publica.
