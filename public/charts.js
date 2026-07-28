'use strict';

/**
 * Gráficos en SVG, sin librerías.
 *
 * Colores: verde = ingresos, rojo = gastos (el par está validado para daltonismo
 * con separación en el límite, así que las series siempre llevan además leyenda,
 * posición fija dentro del grupo y 2px de aire entre barras). Azul = costos de
 * auto y quinta, que no son parte del flujo mensual de plata.
 * Las tablas de cada pantalla son la "vista tabla" de los mismos números.
 */
const CHART_COLORS = {
  income: 'var(--chart-income)',
  expense: 'var(--chart-expense)',
  neutral: 'var(--chart-neutral)',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/** Barra con la punta redondeada y la base cuadrada sobre la línea del cero. */
function columnPath(x, y, w, h, r = 4, down = false) {
  const radius = Math.min(r, w / 2, Math.max(h, 0));
  if (h <= 0.5) return `M${x} ${y}h${w}`;
  if (down) {
    // arranca en la base (y) y crece hacia abajo: redondeo en la punta de abajo
    return `M${x} ${y}v${h - radius}a${radius} ${radius} 0 0 0 ${radius} ${radius}h${w - radius * 2}a${radius} ${radius} 0 0 0 ${radius} -${radius}V${y}Z`;
  }
  return `M${x} ${y + h}V${y + radius}a${radius} ${radius} 0 0 1 ${radius} -${radius}h${w - radius * 2}a${radius} ${radius} 0 0 1 ${radius} ${radius}V${y + h}Z`;
}

/** Escala redondeada a números limpios. Admite valores negativos (línea del cero). */
function niceScale(max, min = 0) {
  const span = Math.max(max, 0) - Math.min(min, 0);
  if (!(span > 0)) return { top: 1, bottom: 0, ticks: [0, 1] };
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) || magnitude * 10;
  const top = Math.ceil(Math.max(max, 0) / step) * step;
  const bottom = -Math.ceil(Math.abs(Math.min(min, 0)) / step) * step;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.abs(v) < step / 1000 ? 0 : v);
  return { top, bottom, ticks };
}

const shortMoney = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? '-' : ''}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',')}M`;
  if (abs >= 1000) return `${n < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  return `${n < 0 ? '-' : ''}$${Math.round(abs)}`;
};

// ---------------------------------------------------------------- tooltip

let tipNode = null;

function chartTip() {
  if (!tipNode) {
    tipNode = document.createElement('div');
    tipNode.className = 'chart-tip';
    tipNode.hidden = true;
    document.body.append(tipNode);
  }
  return tipNode;
}

function attachTip(node, text) {
  node.addEventListener('mouseenter', (e) => {
    const tip = chartTip();
    tip.textContent = text;
    tip.hidden = false;
    moveTip(e);
  });
  node.addEventListener('mousemove', moveTip);
  node.addEventListener('mouseleave', () => {
    chartTip().hidden = true;
  });
  node.append(svg('title', {}, [document.createTextNode(text)]));
}

function moveTip(e) {
  const tip = chartTip();
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10)}px`;
  tip.style.top = `${Math.max(e.clientY - tip.offsetHeight - 10, 8)}px`;
}

// ---------------------------------------------------------------- columnas

/**
 * Columnas por mes. `series` = [{ name, color, values[] }].
 * Con dos series arma leyenda; con una sola, el título ya dice qué es.
 */
function chartColumns({
  labels,
  series,
  width = 1400,
  height = 210,
  title,
  note,
  onSelect,
  selected,
  colorFor,
  format = money,
  shortFormat = shortMoney,
}) {
  const pad = { top: 22, right: 16, bottom: 26, left: 74 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = series.flatMap((s) => s.values.map((v) => v || 0));
  const { top, bottom, ticks } = niceScale(Math.max(0, ...values), Math.min(0, ...values));
  const span = top - bottom || 1;
  const y = (v) => pad.top + plotH - ((Math.max(bottom, Math.min(top, v || 0)) - bottom) / span) * plotH;
  const zero = y(0);
  const slot = plotW / labels.length;
  const gap = 2;
  const barW = Math.min(24, (slot - 14) / series.length - gap);

  // Mes donde cada serie toca su extremo: es la única etiqueta directa que dibujamos.
  const peaks = series.map((s) => {
    const best = Math.max(...s.values.map((v) => Math.abs(v || 0)));
    return best > 0 ? s.values.findIndex((v) => Math.abs(v || 0) === best) : -1;
  });
  const sharedPeak = peaks.length > 1 && peaks[0] >= 0 && peaks.every((p) => p === peaks[0]);

  const marks = [];
  const gridlines = ticks.map((t) =>
    svg('g', {}, [
      svg('line', {
        x1: pad.left,
        x2: width - pad.right,
        y1: y(t),
        y2: y(t),
        class: t === 0 && bottom < 0 ? 'chart-grid-line is-zero' : 'chart-grid-line',
      }),
      svg('text', { x: pad.left - 10, y: y(t) + 4, class: 'chart-axis', 'text-anchor': 'end' }, [
        document.createTextNode(shortFormat(t)),
      ]),
    ])
  );

  labels.forEach((label, i) => {
    const groupW = series.length * barW + (series.length - 1) * gap;
    const startX = pad.left + slot * i + (slot - groupW) / 2;
    series.forEach((s, si) => {
      const value = s.values[i] || 0;
      const x = startX + si * (barW + gap);
      const negative = value < 0;
      const h = Math.abs(zero - y(value));
      const mark = svg('path', {
        // Los negativos crecen para abajo desde la línea del cero.
        d: negative
          ? columnPath(x, zero, barW, h, 4, true)
          : columnPath(x, y(value), barW, h),
        fill: colorFor ? colorFor(value, i) : s.color,
        class: 'chart-mark' + (onSelect ? ' is-clickable' : '') + (selected === i ? ' is-selected' : ''),
      });
      attachTip(mark, `${label} · ${s.name}: ${format(value)}`);
      if (onSelect) mark.addEventListener('click', () => onSelect(i));
      marks.push(mark);

      // Etiqueta directa sólo en el máximo de cada serie (nunca en todas). Si las dos
      // series pican el mismo mes, cada una se corre hacia afuera del grupo para no
      // pisarse: la etiqueta nunca se recorta ni se superpone.
      if (peaks[si] === i && value !== 0) {
        const text = shortFormat(value);
        const textW = text.length * 6.8; // aproximación suficiente para no pisar los bordes
        const outward = sharedPeak && series.length === 2;
        let anchor = 'middle';
        let labelX = x + barW / 2;
        if (outward) {
          // Las dos series pican el mismo mes: cada etiqueta se corre hacia afuera,
          // y si se saldría del marco se apoya contra el borde del área de dibujo.
          if (si === 0) {
            anchor = 'end';
            labelX = Math.max(startX - 4, pad.left + textW);
          } else {
            anchor = 'start';
            labelX = startX + groupW + 4;
            if (labelX + textW > width - pad.right) {
              anchor = 'end';
              labelX = width - pad.right;
            }
          }
        }
        marks.push(
          svg(
            'text',
            {
              x: labelX,
              y: negative ? y(value) + 14 : y(value) - 6,
              class: 'chart-peak',
              'text-anchor': anchor,
            },
            [document.createTextNode(text)]
          )
        );
      }
    });

    marks.push(
      svg(
        'text',
        {
          x: pad.left + slot * i + slot / 2,
          y: height - 8,
          class: selected === i ? 'chart-axis is-selected' : 'chart-axis',
          'text-anchor': 'middle',
        },
        [document.createTextNode(label)]
      )
    );
  });

  const plot = svg(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': title || 'gráfico' },
    [...gridlines, ...marks]
  );

  return chartFrame({ title, note, plot, series: series.length > 1 ? series : null });
}

/** Línea mensual con relleno suave: sirve para acumulados y evoluciones. */
function chartLine({ labels, values, color, width = 460, height = 190, title, note, valueName = 'Acumulado' }) {
  const pad = { top: 20, right: 14, bottom: 26, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const { top, bottom, ticks } = niceScale(Math.max(0, ...values), Math.min(0, ...values));
  const span = top - bottom || 1;
  const x = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const y = (v) => pad.top + plotH - ((v - bottom) / span) * plotH;

  const points = values.map((v, i) => [x(i), y(v || 0)]);
  const line = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
  const area = `${line} L${points[points.length - 1][0]} ${y(Math.max(0, bottom))} L${points[0][0]} ${y(Math.max(0, bottom))} Z`;

  const gridlines = ticks.map((t) =>
    svg('g', {}, [
      svg('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: 'chart-grid-line' }),
      svg('text', { x: pad.left - 8, y: y(t) + 4, class: 'chart-axis', 'text-anchor': 'end' }, [
        document.createTextNode(shortMoney(t)),
      ]),
    ])
  );

  const dots = values.map((v, i) => {
    // El aro del color de la superficie hace de zona de hover y separa el punto de la línea.
    const dot = svg('circle', { cx: x(i), cy: y(v || 0), r: 5, fill: color, class: 'chart-dot' });
    attachTip(dot, `${labels[i]} · ${valueName}: ${money(v || 0)}`);
    return dot;
  });

  const lastIndex = values.length - 1;
  const marks = [
    svg('path', { d: area, fill: color, class: 'chart-area' }),
    svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    ...dots,
    svg(
      'text',
      { x: x(lastIndex), y: y(values[lastIndex] || 0) - 12, class: 'chart-peak', 'text-anchor': 'end' },
      [document.createTextNode(shortMoney(values[lastIndex] || 0))]
    ),
  ];

  const axis = labels.map((label, i) =>
    i % 2 === 0
      ? svg('text', { x: x(i), y: height - 8, class: 'chart-axis', 'text-anchor': 'middle' }, [
          document.createTextNode(label),
        ])
      : null
  );

  const plot = svg(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': title || 'gráfico' },
    [...gridlines, ...marks, ...axis.filter(Boolean)]
  );

  return chartFrame({ title, note, plot });
}

function chartFrame({ title, note, plot, series }) {
  const head = [];
  if (title) head.push(el('h3', { class: 'chart-title', text: title }));
  if (note) head.push(el('span', { class: 'chart-note', text: note }));
  if (series) {
    head.push(el('span', { class: 'spacer' }));
    head.push(
      el(
        'div',
        { class: 'chart-legend' },
        series.map((s) =>
          el('span', { class: 'legend-item' }, [
            el('span', { class: 'legend-swatch', style: `background:${s.color}` }),
            el('span', { text: s.name }),
          ])
        )
      )
    );
  }
  return el('div', { class: 'chart-box' }, [
    head.length ? el('div', { class: 'chart-head' }, head) : null,
    plot,
  ]);
}

/**
 * Ranking en barras horizontales. Los nombres de categoría son largos y no entran abajo de
 * una columna: acostadas se leen enteras y el orden se ve de arriba hacia abajo.
 *
 * `items` = [{ label, value, color?, onSelect? }]. Con `selected` se marca una.
 */
function chartBars({ items, width = 460, title, note, format = shortMoney, selected = null, onSelect = null }) {
  const alto = 26;
  const anchoEtiqueta = Math.min(150, Math.max(90, width * 0.32));
  const height = Math.max(items.length * alto + 8, 40);
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const anchoBarra = width - anchoEtiqueta - 62;

  const plot = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', preserveAspectRatio: 'xMidYMid meet' });

  items.forEach((item, i) => {
    const y = i * alto + 4;
    const w = Math.max((Math.abs(item.value) / max) * anchoBarra, 2);
    const color = item.color || CHART_COLORS.expense;
    const grupo = svg('g', {
      class: 'bar-row' + (selected === i ? ' is-selected' : '') + (onSelect ? ' is-clickable' : ''),
    });

    // Una franja invisible detrás de toda la fila: el clic y el tooltip agarran en
    // cualquier lado, no sólo sobre la barra.
    grupo.append(svg('rect', { x: 0, y: y - 2, width, height: alto - 2, class: 'bar-hit', rx: 5 }));
    grupo.append(
      svg('text', { x: 0, y: y + alto / 2 - 2, class: 'bar-label', 'dominant-baseline': 'middle' }, [
        document.createTextNode(item.label),
      ])
    );
    grupo.append(svg('rect', { x: anchoEtiqueta, y: y + 3, width: w, height: alto - 12, rx: 4, fill: color }));
    grupo.append(
      svg('text', { x: anchoEtiqueta + w + 7, y: y + alto / 2 - 2, class: 'bar-value', 'dominant-baseline': 'middle' }, [
        document.createTextNode(format(item.value)),
      ])
    );

    attachTip(grupo, `${item.label}: ${format(item.value)}`);
    if (onSelect) {
      grupo.addEventListener('click', () => onSelect(i, item));
      grupo.setAttribute('tabindex', '0');
      grupo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(i, item);
        }
      });
    }
    plot.append(grupo);
  });

  return chartFrame({ title, note, plot });
}

/** Fila de números sueltos: lo que no necesita gráfico. */
function statRow(stats) {
  return el(
    'div',
    { class: 'stats' },
    stats.filter(Boolean).map((s) =>
      el('div', { class: `stat${s.tone ? ` is-${s.tone}` : ''}` }, [
        el('span', { class: 'stat-label', text: s.label }),
        el('strong', { class: 'stat-value', text: s.value }),
        s.sub ? el('span', { class: 'stat-sub', text: s.sub }) : null,
      ])
    )
  );
}

function progressBar({ done, total, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return el('div', { class: 'progress-wrap' }, [
    el('div', { class: 'progress-head' }, [
      el('span', { class: 'hint', text: label }),
      el('span', { class: 'hint', text: `${pct}%` }),
    ]),
    el('div', { class: 'progress' }, [el('div', { class: 'progress-fill', style: `width:${pct}%` })]),
  ]);
}
