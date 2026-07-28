-- Correr una sola vez, después de tools/migrar-a-supabase.js --aplicar.
--
-- La migración inserta los id que ya existían para no perder la identidad de cada fila.
-- Postgres lleva su propio contador aparte, que quedó en cero: sin esto, el primer gasto
-- que cargues intentaría usar el id 1 y chocaría con uno importado.
--
-- Deja cada contador arrancando arriba del id más alto que se importó.

do $$
declare t text;
begin
  foreach t in array array[
    'categorias', 'celdas', 'movimientos', 'subcategorias',
    'autos', 'auto_services', 'auto_plan', 'quinta', 'quinta_pendientes'
  ]
  loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, ''id''), coalesce((select max(id) from %I), 0) + 1, false)',
      t, t
    );
  end loop;
end $$;

-- Control: que los números coincidan con los que mostró el migrador
select 'categorias' as tabla, count(*) from categorias
union all select 'celdas', count(*) from celdas
union all select 'movimientos', count(*) from movimientos
union all select 'subcategorias', count(*) from subcategorias
union all select 'autos', count(*) from autos
union all select 'auto_services', count(*) from auto_services
union all select 'auto_plan', count(*) from auto_plan
union all select 'quinta', count(*) from quinta
union all select 'quinta_pendientes', count(*) from quinta_pendientes;
