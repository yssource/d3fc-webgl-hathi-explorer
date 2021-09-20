import { seriesSvgAnnotation } from './annotation-series.js';

import * as d3 from 'd3';
import * as fc from 'd3fc';
import { annotationCallout } from 'd3-svg-annotation';
import * as Arrow from 'apache-arrow/Arrow';
import funkyPointSeries from './streamingPointSeries';
import funkyAttribute from './streamingAttribute';
import indexedFillColor from './indexedFillColor';
// @ts-ignore
import arrowFile from './data.arrow';
import thing from './thing';

const VALUE_BUFFER_SIZE = 4e6; // 1M values * 4 byte value width
const columnValues = columnName => batch => batch.select(columnName).getChildAt(0).values;

const data = {
  pointers: [],
  annotations: [],
  length: 0,
  batches: [],
  table: null
};

window.data = data;

// compute the fill color for each datapoint
const languageAttribute = funkyAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE)
  // WebGL doesn't support 32-bit integers
  // because it's based around 32-bit floats.
  // Therefore, ignore 16 most significant bits.
  .type(fc.webglTypes.UNSIGNED_SHORT)
  .stride(4);

const languageFill = indexedFillColor()
  .attribute(languageAttribute)
  .range([0, d3.schemeCategory10.length - 1])
  .value(d => d3.color(d3.schemeCategory10[Math.round(d)]))
  .clamp(false);

const yearAttribute = funkyAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE)
  // WebGL doesn't support 32-bit integers
  // because it's based around 32-bit floats.
  // Therefore, ignore 16 most significant bits.
  .type(fc.webglTypes.UNSIGNED_SHORT)
  .stride(4);

const yearColorScale = d3.scaleSequential()
  .domain([1850, 2000])
  .interpolator(d3.interpolateRdYlGn);

const yearFill = indexedFillColor()
  .attribute(yearAttribute)
  .range(yearColorScale.domain())
  .value(d => d3.color(yearColorScale(d)))
  .clamp(true);

let fillColor = yearFill;

// LSB - assume little endian
const indexAttribute = funkyAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE)
  .type(fc.webglTypes.UNSIGNED_SHORT)
  .size(2);

const seenIndices = new Set();

const aThing = thing(1024);
const pointSeries = funkyPointSeries(VALUE_BUFFER_SIZE);
// typescript...
pointSeries.decorate((programBuilder, data) => {
  indexAttribute.data(data.batches.map(columnValues('ix')));
  // data.pointers[0] = {x: -17.02014846235419, y: 7.688229056203607};
  data.annotations = [];
  if (data.pointers[0] != null) {
    const { index, distance } = aThing(programBuilder, data, data.pointers[0], indexAttribute);
    if (distance < 2) {
      seenIndices.add(index);
      // console.log(data.pointers[0], index, data.table.get(index).getValue(6), data.table.get(index).getValue(7))
      // console.log(seenIndices.size);
      data.annotations = [
        createAnnotationData(data.table.get(index))
      ];
    }
  }
  languageAttribute.data(data.batches.map(columnValues('language')));
  yearAttribute.data(data.batches.map(columnValues('date')));
  fillColor(programBuilder);
});

// wire up the fill color selector
for (const el of document.querySelectorAll('.controls a')) {
  el.addEventListener('click', () => {
    for (const el2 of document.querySelectorAll('.controls a')) {
      el2.classList.remove('active');
    }
    el.classList.add('active');
    fillColor = el.id === 'language' ? languageFill : yearFill;
    redraw();
  });
}

const createAnnotationData = row => ({
  note: {
    label: row.getValue(row.getIndex('first_author_name')) +
      ' ' + row.getValue(row.getIndex('date')),
    bgPadding: 5,
    title: row.getValue(row.getIndex('title')).replace(/(.{100}).*/, '$1...')
  },
  x: row.getValue(row.getIndex('x')),
  y: row.getValue(row.getIndex('y')),
  dx: 20,
  dy: 20
});

const run = async () => {
  const response = await fetch(arrowFile);
  const reader = await Arrow.RecordBatchReader.from(response);
  // configure the accessors
  // must access the underlying value arrays otherwise we'll end up with shallow copies which trips the dirty checks in the attribute
  pointSeries.crossValues(d => d.batches.map(columnValues('x')));
  pointSeries.mainValues(d => d.batches.map(columnValues('y')));
  for await (const recordBatch of reader) {
    data.batches.push(recordBatch);
    // data.length = 512;
    data.length += recordBatch.length;
    document.querySelector('#loading>span').innerHTML = new Intl.NumberFormat().format(data.length) + ' points loaded';
    redraw();
    break;
  }

  data.table = new Arrow.Table(data.batches[0].schema, data.batches);
};

run();

const xScale = d3.scaleLinear().domain([-50, 50]);
const yScale = d3.scaleLinear().domain([-50, 50]);

const pointer = fc.pointer().on('point', (pointers) => {
  data.pointers = pointers.map(({ x, y }) => ({
    x: xScale.invert(x),
    y: yScale.invert(y)
  }));

  redraw();
});

const annotationSeries = seriesSvgAnnotation()
  .notePadding(15)
  .type(annotationCallout);
const zoom = fc.zoom().on('zoom', redraw);

const chart = fc
  .chartCartesian(xScale, yScale)
  .webglPlotArea(
    // only render the point series on the WebGL layer
    fc
      .seriesWebglMulti()
      .series([pointSeries])
  )
  .svgPlotArea(
    // only render the annotations series on the SVG layer
    fc
      .seriesSvgMulti()
      .series([annotationSeries])
      .mapping(d => d.annotations)
  )
  .decorate(sel => {
    sel.enter()
      .select('.svg-plot-area')
      .call(zoom, xScale, yScale)
      .call(pointer);
  });
// render the chart with the required data
// Enqueues a redraw to occur on the next animation frame
function redraw() {
  d3.select('#chart').datum(data).call(chart);
};
