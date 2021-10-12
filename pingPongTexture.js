export default () => {
    let location = -1;
    let dirty = true;
    let dirtyTexture = null;
    let textureA = null;
    let textureB = null;
    let size = null;
    let framebuffer = null;
    let depthBuffer = null;
    let enable = false;
    let unit = 0;

    function configureTexture(gl, texture, blank) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        const level = 0, border = 0, data = blank ? new Uint8Array(4) : null;
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, blank ? 1 : size[0], blank ? 1 : size[1], border, gl.RGBA, gl.UNSIGNED_BYTE, data);
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

        if (depthBuffer == null) {
            depthBuffer = gl.createRenderbuffer();
        }

        if (dirty) {
            configureTexture(gl, textureA, true);
            configureTexture(gl, textureB, false);
            gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size[0], size[1]);
            dirtyTexture = textureA;
            dirty = false;
        } else if (dirtyTexture) {
            configureTexture(gl, dirtyTexture, false);
            dirtyTexture = null;
        }

        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textureA);
        gl.uniform1i(location, unit);

        gl.viewport(
            0,
            0,
            enable ? size[0] : gl.canvas.width,
            enable ? size[1] : gl.canvas.height
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, enable ? framebuffer : null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, enable ? depthBuffer : null);

        if (enable) {
            const level = 0;
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureB, level);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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

    pingPongTexture.location = (...args) => {
        if (!args.length) {
            return location;
        }
        location = args[0];
        return pingPongTexture;
    };

    pingPongTexture.size = (...args) => {
        if (!args.length) {
            return size;
        }
        if (size !== args[0]) {
            size = args[0];
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

    pingPongTexture.unit = (...args) => {
        if (!args.length) {
            return unit;
        }
        unit = args[0];
        return pingPongTexture;
    };

    return pingPongTexture;
};