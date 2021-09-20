import { webglProgramBuilder, webglUniform } from "d3fc";

function getDefaultViewportSize(programBuilder) {
    const context = programBuilder.context();
    const pixelRatio = programBuilder.pixelRatio();
    return {
        width: context.canvas.width * pixelRatio,
        height: context.canvas.height * pixelRatio
    };
}

const vertexShader = () => `
precision mediump float;

uniform float uTextureSize;
uniform float uCanvasSize;
uniform sampler2D uTexture;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    float index = aIndex[0];

    vec2 target = vec2(mod(index, uCanvasSize), floor(index / uCanvasSize));
    // center on pixels
    target = target + 0.5;
    // convert to clip space
    target = target / (uCanvasSize / 2.0) - 1.0;

    gl_Position = vec4(target.x, target.y, 0.0, 1.0);
    gl_PointSize = 1.0;

    vec2 source = vec2(mod(index, uTextureSize), floor(index / uTextureSize));
    // center on pixels
    source = source + 0.5;
    // convert to texture space
    source = source / uTextureSize;

    vFragColor = texture2D(uTexture, source);
}
`;

const fragmentShader = () => `
precision mediump float;

varying vec4 vFragColor;

void main() {
    gl_FragColor = vFragColor;
}
`;

export default () => {
    const toArrayProgramBuilder = webglProgramBuilder()
        .fragmentShader(fragmentShader)
        .vertexShader(vertexShader);

    let location = -1;
    let dirty = true;
    let dirtyTexture = null;
    let textureA = null;
    let textureB = null;
    let width = null;
    let height = null;
    let framebuffer = null;
    let enable = false;

    function configureTexture(gl, texture, blank) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        const level = 0, border = 0, data = blank ? new Uint8Array(4) : null;
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, blank ? 1 : width, blank ? 1 : height, border, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    const pingPongTexture = programBuilder => {
        const gl = programBuilder.context();

        if (textureA == null) {
            textureA = gl.createTexture();
        }

        if (textureB == null) {
            textureB = gl.createTexture();
        }

        if (framebuffer == null) {
            framebuffer = gl.createFramebuffer();
        }

        if (dirty) {
            configureTexture(gl, textureA, true);
            configureTexture(gl, textureB, false);
            dirtyTexture = textureA;
            dirty = false;
        } else if (dirtyTexture) {
            configureTexture(gl, dirtyTexture, false);
            dirtyTexture = null;
        }

        const unit = 0;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textureA);
        gl.uniform1i(location, unit);

        const viewportSize = getDefaultViewportSize(programBuilder);
        gl.viewport(
            0,
            0,
            enable ? width : viewportSize.width,
            enable ? height : viewportSize.height
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, enable ? framebuffer : null);

        if (enable) {
            const level = 0;
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureB, level);

            // swap the buffers
            const temp = textureA;
            textureA = textureB;
            textureB = temp;
        }
    };

    pingPongTexture.clear = () => {
        dirty = true;
        textureA = null;
        textureB = null;
        framebuffer = null;
    };

    pingPongTexture.toArray = (programBuilder, array, length) => { // length might not be a great name, it's really the pixel count
        let _enable = enable;
        pingPongTexture.enable(false);

        toArrayProgramBuilder.context(programBuilder.context())
            .pixelRatio(programBuilder.pixelRatio())
            .mode(programBuilder.context().POINTS);

        if (length == null || length > width * height) {
            throw new Error('Invalid length');
        }

        const viewportSize = getDefaultViewportSize(programBuilder);
        if (viewportSize.width * viewportSize.height < length) {
            throw new Error('Texture too large to extract in one pass');
        }

        toArrayProgramBuilder.buffers()
            .attribute('aIndex', programBuilder.buffers().attribute('aIndex')) // HACK!
            .uniform('uTexture', pingPongTexture)
            .uniform('uCanvasSize', webglUniform([viewportSize.width]))
            .uniform('uTextureSize', webglUniform([width]));

        toArrayProgramBuilder(length);

        const gl = toArrayProgramBuilder.context();
        for (let offset = 0; offset < length; offset += viewportSize.width) {
            // This is non-optimal if length >= viewportSize.width * 2
            gl.readPixels(0, 0, Math.min(length - offset, viewportSize.width), 1, gl.RGBA, gl.UNSIGNED_BYTE, array.subarray(offset));
        }
        
        pingPongTexture.enable(_enable);
    };

    pingPongTexture.location = (...args) => {
        if (!args.length) {
            return location;
        }
        location = args[0];
        return pingPongTexture;
    };

    pingPongTexture.width = (...args) => {
        if (!args.length) {
            return width;
        }
        if (width !== args[0]) {
            width = args[0];
            dirty = true;
        }
        return pingPongTexture;
    };

    pingPongTexture.height = (...args) => {
        if (!args.length) {
            return height;
        }
        if (height !== args[0]) {
            height = args[0];
            dirty = true;
        }
        return pingPongTexture;
    };

    pingPongTexture.enable = (...args) => {
        if (!args.length) {
            return enable;
        }
        if (enable !== args[0]) {
            enable = args[0];
        }
        return pingPongTexture;
    };

    return pingPongTexture;
};