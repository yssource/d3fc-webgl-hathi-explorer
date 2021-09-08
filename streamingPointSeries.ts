import { scaleIdentity, symbolCircle } from 'd3';
import {
    rebind,
    webglSeriesPoint,
    webglScaleMapper,
    webglSymbolMapper
} from 'd3fc';
import webglConstantAttribute from '@d3fc/d3fc-webgl/src/buffer/constantAttribute'
import streamingAttribute from './streamingAttribute'

export default (maxByteLength) => {
    const crossValueAttribute = streamingAttribute()
        .maxByteLength(maxByteLength);
    const mainValueAttribute = streamingAttribute()
        .maxByteLength(maxByteLength);
    const sizeAttribute = webglConstantAttribute();
    const definedAttribute = webglConstantAttribute();

    const draw = webglSeriesPoint()
        .crossValueAttribute(crossValueAttribute)
        .mainValueAttribute(mainValueAttribute)
        .sizeAttribute(sizeAttribute)
        .definedAttribute(definedAttribute);

    let xScale = scaleIdentity();
    let yScale = scaleIdentity();
    let mainValues = d => d.y;
    let decorate = (programBuilder, data, index) => { };
    let crossValues = d => d.x;

    const streamingPointSeries = (data) => {
        sizeAttribute.value([1]);
        definedAttribute.value([true]);

        mainValueAttribute.data(mainValues(data));
        crossValueAttribute.data(crossValues(data));

        // The following assumes there is no d3 scale required
        const xWebglScale = webglScaleMapper(xScale).webglScale;
        const yWebglScale = webglScaleMapper(yScale).webglScale;

        draw.xScale(xWebglScale)
            .yScale(yWebglScale)
            .type(webglSymbolMapper(symbolCircle))
            .decorate(programBuilder => {
                decorate(programBuilder, data, 0);
            });
        draw(data.length);
    };

    streamingPointSeries.xScale = (...args) => {
        if (!args.length) {
            return xScale;
        }
        xScale = args[0];
        return streamingPointSeries;
    };

    streamingPointSeries.yScale = (...args) => {
        if (!args.length) {
            return yScale;
        }
        yScale = args[0];
        return streamingPointSeries;
    };

    streamingPointSeries.mainValues = (...args) => {
        if (!args.length) {
            return mainValues;
        }
        mainValues = args[0];
        return streamingPointSeries;
    };

    streamingPointSeries.crossValues = (...args) => {
        if (!args.length) {
            return crossValues;
        }
        crossValues = args[0];
        return streamingPointSeries;
    };

    streamingPointSeries.decorate = (...args) => {
        if (!args.length) {
            return decorate;
        }
        decorate = args[0];
        return streamingPointSeries;
    };

    rebind(streamingPointSeries, draw, 'context', 'pixelRatio');

    return streamingPointSeries;
};
