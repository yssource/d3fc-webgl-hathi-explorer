import { seriesSvgAnnotation } from './annotation-series.js';

import * as d3 from 'd3';
import * as fc from 'd3fc';
import * as Arrow from 'apache-arrow/Arrow';
import streamingPointSeries from './streamingPointSeries';
import streamingAttribute from './streamingAttribute';
import indexedFillColor from './indexedFillColor';
import closestPoint from './closestPoint';

// @ts-ignore
import arrowFile from './data.arrow';

const VALUE_BUFFER_SIZE = 4e6; // 1M values * 4 byte value width

// when configuring the accessors, we must access the underlying 
// value arrays otherwise we'll end up with shallow copies which
// will trip the dirty checks in streaming attribute
const columnValues = (table, columnName) => table.select(columnName)
  .getChildAt(0).chunks
  .map(chunk => chunk.data.values);

// cheap way of allowing an empty chart to render
const EMPTY_TABLE = {
  length: 0,
  select() {
    return {
      getChildAt() {
        return {
          get chunks() {
            return [];
          }
        }
      }
    }
  }
};

const data = {
  pointers: [],
  annotations: [],
  table: (<any>EMPTY_TABLE)
};

const hackyReferenceToTopLevelData = data;

// compute the fill color for each datapoint
const languageAttribute = streamingAttribute()
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

const yearAttribute = streamingAttribute()
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

const xScale = d3.scaleLinear().domain([-50, 50]);
const yScale = d3.scaleLinear().domain([-50, 50]);

// LSB - assume little endian
const indexAttribute = streamingAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE)
  .type(fc.webglTypes.UNSIGNED_SHORT)
  .size(2);

// typescript...
const findClosestPoint = closestPoint(1024);
(<any>findClosestPoint).indexValueAttribute(indexAttribute);
const pointSeries = streamingPointSeries(VALUE_BUFFER_SIZE);
pointSeries.crossValues(d => columnValues(d, 'x'));
pointSeries.mainValues(d => columnValues(d, 'y'));
pointSeries.decorate((programBuilder, data) => {
  // using raw attributes means we need to explicitly pass the data in
  languageAttribute.data(columnValues(data, 'language'));
  yearAttribute.data(columnValues(data, 'date'));
  indexAttribute.data(columnValues(data, 'ix'));

  // configure
  (<any>findClosestPoint).context(programBuilder.context())
    .mainValueAttribute(programBuilder.buffers().attribute('aMainValue'))
    .crossValueAttribute(programBuilder.buffers().attribute('aCrossValue'));

  if (hackyReferenceToTopLevelData.pointers[0] != null) {
    const { index, distance } = findClosestPoint(data.length, hackyReferenceToTopLevelData.pointers[0]);
    hackyReferenceToTopLevelData.annotations = distance < 2 ? [
      createAnnotationData(data.get(index))
    ] : [];
  } else {
    hackyReferenceToTopLevelData.annotations = [];
  }

  fillColor(programBuilder);
});

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

const annotationSeries = seriesSvgAnnotation()
  .notePadding(15)
  .key(d => d.ix);

const pointer = fc.pointer()
  .on('point', (pointers) => {
    data.pointers = pointers.map(({ x, y }) => ({
      x: xScale.invert(x),
      y: yScale.invert(y)
    }));
    redraw();
  });

const zoom = fc.zoom()
  .on('zoom', redraw);

const chart = fc
  .chartCartesian(xScale, yScale)
  .webglPlotArea(
    // only render the point series on the WebGL layer
    fc
      .seriesWebglMulti()
      .series([pointSeries])
      .mapping(d => d.table)
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
  d3.select('#chart')
    .datum(data)
    .call(chart);
};

// stream the data
const loadData = async () => {
  const response = await fetch(arrowFile);
  const reader = await Arrow.RecordBatchReader.from(response);
  await reader.open();
  data.table = new Arrow.Table(reader.schema);
  for await (const recordBatch of reader) {
    data.table = data.table.concat(recordBatch);
    document.querySelector('#loading>span').innerHTML =
      new Intl.NumberFormat().format(data.table.length) + ' points loaded';
    redraw();
  }
};

redraw();
loadData();