import { rebind, webglBaseAttribute } from 'd3fc';
import { getArrayViewConstructor } from '@d3fc/d3fc-webgl/src/buffer/types';

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

export default () => {
    const base = webglBaseAttribute();
    let data: TypedArray[] = [];
    let previousData: TypedArray[] = null;
    let maxByteLength: number = 0;

    const streamingAttribute: any = programBuilder => {
        base(programBuilder);

        const expectedType = getArrayViewConstructor(base.type());

        const combinedByteLength = data.reduce((sum, { byteLength }) => sum + byteLength, 0);
        if (combinedByteLength > maxByteLength) {
            throw new Error(`Combined byteLength ${combinedByteLength} > maxBytelength ${maxByteLength}`);
        }
        
        const gl = programBuilder.context();
        gl.bindBuffer(gl.ARRAY_BUFFER, base.buffer());
        
        if (previousData == null) {
            gl.bufferData(gl.ARRAY_BUFFER, maxByteLength, gl.DYNAMIC_DRAW);
            previousData = [];
        }

        const previousCombinedByteLength = previousData.reduce((sum, { byteLength }) => sum + byteLength, 0);
        if (combinedByteLength < previousCombinedByteLength) {
            console.warn(`Not sure if this is important yet`);
        }

        let offset = 0;
        let remainingInvalid = false;
        for (let i = 0; i < data.length; i++) {
            // if (!(data[i] instanceof expectedType)) {
            //     throw new Error(`Unexpected array type - expecting ${expectedType}`);
            // }
            if (previousData[i] == null || data[i].byteLength !== previousData[i].byteLength) {
                remainingInvalid = true;
            }
            if (remainingInvalid || data[i] !== previousData[i]) {
                gl.bufferSubData(gl.ARRAY_BUFFER, offset, data[i]);
            }
            offset += data[i].byteLength;
        }
        previousData = data.slice(0);
    };

    streamingAttribute.clear = () => {
        base.buffer(null);
        previousData = null;
    };

    streamingAttribute.maxByteLength = (...args) => {
        if (!args.length) {
            return maxByteLength;
        }
        maxByteLength = args[0];
        previousData = null;
        return streamingAttribute;
    };

    streamingAttribute.data = (...args) => {
        if (!args.length) {
            return data;
        }
        data = args[0];
        return streamingAttribute;
    };

    rebind(streamingAttribute, base, 'type', 'size', 'normalized', 'location', 'divisor', 'stride', 'offset');

    return streamingAttribute;
};