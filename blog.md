
In a previous blog post, Colin focused on rendering very large numbers of points using D3. In this post I'll consider how you can efficiently load that data using Apache Arrow.

## Background

If you've not already read [Colin's blog post](https://blog.scottlogic.com/2020/05/01/rendering-one-million-points-with-d3.html), that's a good place to start. A very short summary is that he takes a large (~600k item) dataset, streams it into the browser using a WebWorker and renders it as a point series using WebGL. Once fully loaded, the full dataset can be freely explored with minimal yank. 

<img src="hathi-library-visualisation.png" width=640 height=438 alt="Colin's demo of rendering large numbers of points with D3" />

However, it's fair to say that whilst loading there's a fair amount of yank. To work around this, most functionality (e.g. zooming, padding, shading) is disabled until the chart is fully loaded. There are two main reasons for this slowness -

* The data is not progressively loaded in to the GPU.
  * Each new batch of data reloads all data received so far.
  * Limitation of the high-level API exposed by the d3fc WebGL series.
* The data is not in the right format for the GPU.
  * Each data item must first be transformed before loading in to the GPU.
  * Limitation of the data file format.

In the rest of this post we'll look at one way to optimise these issues for a yank-free loading experience.

*In the next couple of sections, I need to go pretty deep into the internals of a few different technologies. Whilst I've found this journey really interesting, I appreciate that it's not for everyone so I've decided to (literally) inject some personality into the proceedings to try and keep it interesting. Bear with me, I promise the whole post won't be like this!*

## WebGL loves a good buffer

WebGL lives for good old fashioned Float32Arrays. Being able to let rip on those single precision floating point numbers the GPU arithmetic units crave (in a massively parallel manner no less!) is what gets it up in the morning. 

The problem is, D3 datasets tend not to hang out with the hipster buffer crowd. Preferring instead to stick to the UTF-8 string encodings they grew up with. Whilst they might occasionally spice things up, in their eyes nothing beats good old fashioned DSV (delimiter separated format e.g. CSV, TSV) format for simplicity, longevity and often just the ready availability of encoders/decoders.

<img src="super-js.png" width=320 height=240 alt="Bad attempt at a JS superhero logo"/>

Luckily, eschewing buffer encoding doesn't leave WebGL stuck. As Colin's demo showed, the hero of our story, JavaScript, steps up to the task. Putting in an enormous effort to transform between encodings as the data streams in.

Unfortunately, our hero's efforts come with collateral damage: significant CPU load. At best, delivering a yank-y experience. At worst, burning through the user's battery, and lightly toasting their fingers.

The obvious solution to the problem is to perform this processing before it arrives at the browser. In an ideal world, there'd already be a set of data formats that are optimised for storing large datasets as WebGL-compatible buffers. Additionally, there would be a wide variety of existing well-maintained libraries available in the data ecosystem for manipulating these formats, no matter your tool or language of choice.

So I hear big data is a thing...

## Big data / data engineering / whatever-it's-calling-itself-this-week

Big data loves a binary encoding format. When it's not reading an ORC file, it's re-partitioning a set of Parquet files and evolving Avro schemas in the background. On occasion, it's been known to dabble in DSV or JSON files, but these are quickly transformed into more efficient representations... before anyone notices.

<img src="big-data.png" width=640 height=390 alt="Worse attempt at a (x) data (x) hipster"/>

All of these big data file formats are widely supported so that should keep everyone happy, right? Well... no. It turns out there are multiple types of buffer hipster.

As an outsider who's done enough research to be dangerous, my understanding is that the key theme with all of these formats is that they're designed for efficient storage and retrieval of data. They were never intended for use as a data interchange format between running services.

That is to say that they optimise for the smallest file sizes possible whilst still allowing for fast access to a particular piece of data within. Under the hood, they commonly employ tricks like [run-length encoding](https://github.com/apache/parquet-format/blob/master/Encodings.md), [bit-packing](https://github.com/apache/parquet-format/blob/master/Encodings.md#RLE), [variable-length numbers](https://github.com/apache/parquet-format/blob/master/Encodings.md#delta-encoding-delta_binary_packed--5[) and [intra-file compression](https://github.com/apache/parquet-format/blob/master/Compression.md) to help squeeze in as much data as possible. This is alongside a multitude of [indices](https://github.com/apache/parquet-format/blob/master/PageIndex.md), [intra/inter-file partitioning](https://github.com/apache/parquet-format#unit-of-parallelization) and other careful structural choices which allow data to be efficiently retrieved from these large (1GB-ish) and very dense files.

These highly concentrated data formats have made the big data buffer hipsters very happy indeed. And as much as I'm poking fun at them, it is seriously impressive the volumes of data that can be interactively queried using these formats! Unfortunately, they're not going to work for us. The WebGL buffer hipster need their data [straight-up, byte-aligned and uncompressed](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer)... with no foam art.

That's not to say that using these formats wouldn't be the right decision in some cases. Our returning hero JavaScript would be the first to jump valiantly at any opportunity to transform some data. In fact, it may even be in a more finger-friendly/less CPU intense way than parsing DSV, but it is still processing that can be avoided in a situation where we want to minimise CPU load.

Intriguingly, deep inside the heart of big data processing these formats [aren't used](https://arrow.apache.org/overview/) either. When performing most compute operations on the data itself, the data is first transformed into straight-up, byte-aligned and uncompressed buffers (with no foam art). As with WebGL, this additional transformation enables more efficient parallel computation. Albeit this [tends](https://arrow.apache.org/docs/python/cuda.html) to be on the CPU rather than the GPU.

Wouldn't it be great if the big data crowd got together and agreed this internal, compute-optimised format as a standard? A single format that could be used for efficient transfer of data between systems or processes, in a compute-ready format...

And what do you know? In a buffer hipster uniting win for humanity, about 5 years ago, Apache Arrow casually strolled into town.

## Apache Arrow

Apache Arrow eschews almost all of the optimisations that drew WebGL's ire. And that's for a very good reason. Instead of being designed for efficient storage and retrieval of data, it instead [prioritises compute-ready interoperability of data between different services](https://arrow.apache.org/overview/). A format which on-receipt requires minimal, if any, transformation prior to running computationally efficient algorithms on the data. Let's dig into some of the details that make it a good fit for streaming the data into WebGL.

In DSV files, all the fields for a single data item are stored on a single line i.e. `N` lines of `M` fields. However, for our WebGL implementation, not only do we need this data in buffers but we also need to transpose its structure i.e. `M` buffers each containing `N` items.

Taking a few liberties which we'll address in a moment, that's exactly how Arrow arranges its data internally -

```
BUFFER 0 (the data for field 0)
BUFFER 1 (the data for field 1)
...
BUFFER N - 1 (the data for field N - 1)
```

Each of these buffers is guaranteed to be the same length with the values equally spaced within. That means if we wanted to read the values of all fields in a given row, we can just index into each of these buffers in turn -

```js
const row = i => [buffer[0][i], buffer[1][i], /* ..., */ buffer[N - 1][i]];
```

Equally, to load all the data for a given field into WebGL we can just use the buffers directly -

```js
gl.bufferData(target[0], buffer[0], gl.ARRAY_BUFFER);
gl.bufferData(target[1], buffer[1], gl.ARRAY_BUFFER);
// ...
gl.bufferData(target[M - 1], buffer[M - 1], gl.ARRAY_BUFFER);
```

And by directly, I do mean directly. As soon as the browser receives a `RecordBatch` message, after reading some minimal metadata (e.g. offsets) and without any transformation of the data, this data is ready for loading. So what's a `RecordBatch`? 

As the name suggests, it is equivalent to a set of lines from the DSV file. There's nothing stopping you using a single batch for all the data as we were above. However, as the data in a `RecordBatch` can only be used once the full `RecordBatch` has been received, if you've got a lot of data you could be waiting a while for it to load.

In a streaming scenario, splitting the data into smaller batches means faster access to the data in the first `RecordBatch`. However, each `RecordBatch` introduces protocol overhead (i.e. more metadata for a given amount of data) and leaves us with the problem of having to reconstitute the buffers for WebGL's benefit.

Taken to its extreme, if there is only a single record per `RecordBatch`, we end up full circle. With a file somewhat equivalent to a DSV file (`92MB`), just much larger (`644MB`). More reasonable `RecordBatch` sizes (e.g. 10s per file) lead to more reasonable file sizes (roughly equivalent to the DSV file).

To quickly cover off some of the features I've glossed over, compared to DSV it also supports -

* Embedding the data schema i.e. values reliably decode to the same value they were encoded from!
* Custom complex types e.g. a field can itself be a list of items with their own fields.
* Validity flags i.e. first-class support for missing/null values
* Value dictionaries i.e. efficient representation of enum values

It's worth noting that using some of these features can make the WebGL integration harder. In some cases there would be no way around transforming the data using JavaScript. However, in most cases it can be worked around with some *creative* application of WebGL features.

Enough waffle, let's build something!

## Pre-processing the data

As we're starting with an existing DSV file, we need to convert it over to Arrow format. It's a little frustrating to have to start here because one of the big selling features of Arrow is that it is already integrated with most existing tools! So typically this wouldn't be required and you'd be free to export directly from your tool of choice. However, as we've already found ourselves in an artificial situation, why not double down and make our life even more awkward, by using the raw Arrow APIs...

Firstly we need to load the tsv file using the `pyarrow` package. Counter-intuitively, that requires us to use the `csv` module configured to use a tab character as the delimiter -

```py
import pyarrow as pa
from pyarrow import csv
from pathlib import Path


source_path = Path("data.tsv")

table = csv.read_csv(
    source_path,
    parse_options=csv.ParseOptions(
        delimiter="\t",
    ),
    # ...
)

```

I believe this rather odd API is a consequence of being generated directly from the C++ bindings. Or I'm using it wrong. Either way, it only gets worse from here. I would definitely recommend avoiding the `pyarrow` package directly. 

Next up, we need to write out an Arrow format file. The specification defines two formats, a file-based format (`.arrow`) and a streaming format (`.arrows`). The file-based format contains additional metadata to allow for more efficient random access. For our use-case of streaming all of the data straight into a visualisation, this metadata is irrelevant so we'll stick with the streaming format and a `RecordBatch` size of 10,000 -


```py
target_path = Path("data.arrows")

# ...

local = fs.LocalFileSystem()

with local.open_output_stream(str(target_path)) as file:
    with pa.RecordBatchStreamWriter(file, table.schema) as writer:
        writer.write_table(table, 10000)
```

*I told you it it got worse.*

As we're converting to a schema-based format, we can take this opportunity to define the required column types for non-string columns and the sentinel values that have been used to represent `null` -

```py
# ...
    convert_options=pa.csv.ConvertOptions(
        column_types={
            "date": pa.uint32(),
            "x": pa.float32(),
            "y": pa.float32(),
            "ix": pa.uint32(),
            "language": pa.dictionary(pa.int32(), pa.utf8())
        },
        null_values=["None", ""]
# ...
```

Note there's a couple of constraints at play here: WebGL limits us to a maximum size of 32-bits for floats and Arrow limits us to a minimum of 32-bits for integers. I've also opted to encode the language string values using a dictionary as they have relatively low cardinality (unique value count) and a large default encoding (~10 character utf8 string) relative to the dictionary index (32-bit integer).

Not only have we now more easily reason about the data with an explicit schema defined, as a side-effect we've also saved a little on the file size (86MB versus 92MB). It's also worth remembering that these are uncompressed sizes and the browser will happily deal with file-level compression on our behalf. So we'd typically expect significantly less data to actually be transferred over the network (e.g. 86MB gzips to 36MB).

To improve the loading speed across the network, we can also shave a bit more from the file size by removing the unused columns, truncating the titles and unifying the dictionaries across the `RecordBatch`es (saving 22MB raw, 8MB gzipped) -

```py
# remove unused columns
table = table.select(["ix", "x", "y", "title", "first_author_name", "date", "language"])

# truncate the title after 101 characters (matching display logic)
truncated_title = pc.utf8_replace_slice(table.column("title"), start=101, stop=1000, replacement="")
table = table.set_column(table.schema.get_field_index("title"), "title", truncated_title)

# ensure all dictionaries in the file use the same key/value mappings
table = table.unify_dictionaries()
```

Something I didn't realise until after I'd converted the file was quite how many *workarounds* were required to deal with poor quality data in the original demo. Specifically, [quietly dropping records with anomalous column counts](https://github.com/ColinEberhardt/d3fc-webgl-hathi-explorer/blob/master/streaming-tsv-parser.js#L27) and [filtering out non-numeric years](https://github.com/ColinEberhardt/d3fc-webgl-hathi-explorer/blob/master/index.js#L37). As we're now transforming to a schema-based format, I've moved these *workarounds* into the conversion. 

For dropping records with anomalous column counts, I couldn't find any relevant parser configuration. So instead, I just brute-forced it -

```py
temp_path = Path("data-filtered.tsv")

# ...

with open(source_path) as source:
    with open(temp_path, "w") as target:
        for source_line in source:
            if source_line.count("\t") != 8:
                # filter out records with anomalous columns
                continue
            target.write(source_line)

# ...

temp_path.unlink()
```

Filtering out rows with non-numeric years was a little easier. As I'd already explicitly set the column type to `uint32`, the parser was converting these non-numeric values to `null`. I just needed to filter the table to exclude rows where `date` was `null` -

```py
# filter out non-numeric dates (e.g. missing, "1850-1853")
mask = pc.invert(pc.is_null(table.column("date")))
table = table.filter(mask)
```

The final flourish was to sort the data by `date` to improve the loading aesthetics -

```py
# sorting by the date improves the loading aesthetics
# comment this out to exactly match the original appearance
indices = pc.sort_indices(table, sort_keys=[("date", "ascending")])
table = pc.take(table, indices)

# after sorting replace ix with an accurate row index
indices = pc.sort_indices(table, sort_keys=[("date", "ascending")])
table = table.set_column(table.schema.get_field_index("ix"), "ix", pc.cast(indices, pa.uint32()))
```

This seems to work best as the item's on-screen location is less correlated with the date than previously, but retains some level of correlation meaning the higher-concentration areas appear to grow almost organically. The original order resulted in the data loading in an almost chequerboard pattern reminiscent of the dark days of dial-up internet -

<img src="original.gif" width=320 height=240 alt="The original sort order demonstrating blocky loading"/>
<img src="sort-by-date.gif" width=320 height=240 alt="The updated sort order showing organic loading"/>

Note that the poor quality, jankiness, etc. is not reflective of the quality, it's down to me aiming for a small GIF file size. Now we have our final `.arrows` file (28MB gzipped), we can now move onto loading the data into the browser.

## Loading the Arrow data in JavaScript

There's an officially supported [Arrow JavaScript library](https://arrow.apache.org/docs/js/) which makes it trivial to consume Arrow files in the browser (`Table.from(response)`). However, to see the data as it is streaming, it's a little bit more involved -

```js
import * as Arrow from 'apache-arrow/Arrow';

import arrowFile from './data.arrows';

const data = {
  table: Arrow.Table.empty(),
  // ...
};

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

function redraw() {
    // ...
}
```

`RecordBatchReader` takes care of the streaming decoding for us. It consumes chunks from the response stream and provides an `AsyncIterator` of `RecordBatch`es. As our file follows the streaming format, each `RecordBatch` is implicitly made available as soon as its data has been received. If we'd instead opted for the file format, the `RecordBatch`es would only have been made available once all the data had been received.

Initially we wait for `reader.open()` to signal that the schema message has been received. Once we have the schema, we can create a `Table`. This is just a lightweight container for the received `RecordBatch`es which provides convenience methods for accessing the data. For example, the total number of data items exposed as `length`.

As it is an immutable container, we use its `concat` method and a mutable reference to accumulate the data. Whilst this sounds like it could be a heavyweight operation, no significant memory operations are required. It amounts to the recalculation of a few metadata fields (e.g. `length`) and references to the heavyweight buffers being appended to internal lists.

If we compare what's happening here to Colin's original implementation, it's noteworthy that all of this parsing runs in the main thread and yet doesn't cause any performance problems, despite dealing with the same volume of usable data. This is all down to the choice of Arrow as the data interchange format: the data is coming off the wire ready to use.

Frustratingly there's still a small amount of wasted processing. In an ideal world, the data would be read off the wire and gzip decoded by the browser straight into the JavaScript buffers it will ultimately reside in. Unfortunately, the browser allocates a new buffer for each inbound chunk which leaves the Arrow decoder stuck manually copying the chunks into contiguous buffers. The [`ReadableStreamBYOBReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBReader) that would allow control over this, doesn't yet have widespread browser support and where it is supported, it is [not integrated into the `fetch` API](https://bugs.chromium.org/p/chromium/issues/detail?id=1243329&q=byob&can=2) resulting in the following error -

> TypeError: Failed to execute 'getReader' on 'ReadableStream': Cannot use a BYOB reader with a non-byte stream

Despite this setback, for now at least we can now be confident we've got the data into JavaScript and ready for WebGL with the minimal (reasonable) use of CPU possible. Time to stream the data into WebGL.

## Streaming the Arrow data into WebGL

Our starting position is an Arrow `Table` containing `RecordBatch`es. These all share a common schema of `Fields`. Within each is our data, stored within an `ArrayBuffer` and accessed via a `TypedArray` e.g. `Float32Array`.

To render the data, we need to load all of the data for a given `Field` into a WebGL buffer and assign it to the appropriate attribute. We can do this with the WebGL method [`bufferSubData`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/bufferSubData) -

<img src="buffer-sub-data.png" width=640 height=381 alt="Using bufferSubData to load individual TypedArray instances into a single WebGL Buffer"/>

The following code using d3fc as per the original example but most of the concepts are generally applicable. First, we create a new component to represent this custom attribute type -

```ts
import { rebind, webglBaseAttribute } from 'd3fc';

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

export default () => {
    const base = webglBaseAttribute();
    let data: TypedArray[] = [];
    let maxByteLength: number = 0;
    // ...

    const streamingAttribute: any = programBuilder => {
        base(programBuilder);
        
        const gl = programBuilder.context();
        gl.bindBuffer(gl.ARRAY_BUFFER, base.buffer());
        
        // ...
    };

    streamingAttribute.clear = () => {
        base.buffer(null);
    };

    streamingAttribute.maxByteLength = (...args) => {
        if (!args.length) {
            return maxByteLength;
        }
        maxByteLength = args[0];
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
```

If you've ever created a custom component in D3, the above patterns should hopefully be familiar. If not, check out this [introduction from Mike Bostock](https://bost.ocks.org/mike/chart/). In simple terms, we've created a component which builds on, or extends, the functionality of the `webglBaseAttribute`. It is configurable with the `data` we want to load as an array of `TypedArray`s and the combined `maxByteLength` of that data.

Now let's extend this to load the data -

```ts
    const streamingAttribute: any = programBuilder => {
        // ...
        gl.bindBuffer(gl.ARRAY_BUFFER, base.buffer());

        // ...
        gl.bufferData(gl.ARRAY_BUFFER, maxByteLength, gl.DYNAMIC_DRAW);

        let offset = 0;
        // ...
        for (let i = 0; i < data.length; i++) {
            // ...
            gl.bufferSubData(gl.ARRAY_BUFFER, offset, data[i]);
            // ...
            offset += data[i].byteLength;
        }
    };
```

This would work fine to load all the data. However, it would reload the data on every render. What we really want to do is track the data that has already been loaded and only load the newly arrived data. A simple way to do this would be to just retain the count of how many `TypedArray`s have already been loaded but I decided to gold-plate it by implementing dirty-checking on the already loaded data.

A naive approach would be to take a copy of the data as it is loaded and dirty check each value. However, this would requiring a lot of processing and defeat almost everything we've achieved so far. Instead, I implemented dirty-checking using reference equality on the `TypedArray`s within `data` -

```ts
    // ...
    let previousData: TypedArray[] = null;

    const streamingAttribute: any = programBuilder => {
        // ...
        
        if (previousData == null) {
            gl.bufferData(gl.ARRAY_BUFFER, maxByteLength, gl.DYNAMIC_DRAW);
            previousData = [];
        }

        let offset = 0;
        let remainingInvalid = false;
        for (let i = 0; i < data.length; i++) {
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

    // ...

```

Changing the `maxByteLength` is handled in the simplest way by clearing the `previousData` which causes the buffer to be reinitialised to the right length and reloaded with data. `clear`, a framework-level method is called to signal that the buffer is in an unknown state, is handled in the same way.

N.B. the above implementation permits the buffer to contain stale data beyond the combined length (`N`) of the current `data`. However, this is not a problem as these additional values are not read i.e. we only render `N` points.

To make use of this new attribute we need two further things -

* A point series which is able to use the attribute. `seriesWebglPoint` is restricted to using `webglAttribute`. Working around this is just a case of copy-pasting the implementation, removing the unnecessary configurability and exposing the ability to set the attributes we need. Despite being a simple task, the code is pretty verbose so I've opted to [link to it](https://github.com/chrisprice/d3fc-webgl-hathi-explorer/blob/master/optimisedPointSeries.ts) rather than include it here.
* A lightweight way to extract the array of `TypedArray`s we need to pass in to the attribute. The important thing here is that we need this to be fast as it runs every frame and we always need it to return the same `TypedArray` references, so as not to inadvertently trip the dirty checks.

Bringing this all together, gives us the following -

```ts
const VALUE_BUFFER_SIZE = 4e6; // 1M values * 4 byte value width

// ...

const crossValueAttribute = streamingAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE);
const mainValueAttribute = streamingAttribute()
  .maxByteLength(VALUE_BUFFER_SIZE);

const pointSeries = bespokePointSeries()
    .crossValueAttribute(crossValueAttribute)
    .mainValueAttribute(mainValueAttribute);

const columnValues = (table, columnName) => {
  const index = table.getColumnIndex(columnName);
  return table.chunks.filter(chunk => chunk.length > 0)
    .map(chunk => chunk.data.childData[index].values);
};

// ...

const chart = fc.chartCartesian(xScale, yScale)
    // ...
    .webglPlotArea(pointSeries)
    // ...

function redraw() {
  crossValueAttribute.data(columnValues(data.table, 'x'));
  mainValueAttribute.data(columnValues(data.table, 'y'));
  
  // ...

  d3.select('#chart')
    .datum(data)
    .call(chart);
}

```

And here's a version of the above running (as the data file is so large, click to load the demo) -

<iframe></iframe>

If we compare this to Colin's original version, it looks a bit sad. There's no the attribute-based shading and there's no annotation showing the closest point when you hover. This is because in the original version, both features required processing per data item -

* For the shading, it passed each year value through a d3 `scaleSequential` with a `interpolateRdYlGn` interpolator and each after hashing, passed each language through a `scaleOrdinal` with domain set to the `schemeCategory10` colours. 
* For the annotation, a quadtree was built as the data was parsed. This allowed very efficient lookups of the closest data point.

In this version, we've done everything we can to avoid performing per-item processing. Surely adding these features back in would undo all of our good work!

Certainly adding them in in their current form wouldn't work. It is also true that we've done all we can to avoid per-item processing *on the CPU*. However, there's no getting around the fact that we need to render each point. We are definitely performing per-item processing on the GPU. What if there was a way to move these features onto the GPU?

<iframe></iframe>

## Conclusion

Sadly I've run out of space to explain in detail how these features work, but the gist of it involves embracing the massively parallel nature of the GPU to perform these calculations on the fly. Along with a fair bit of fitting square-peg Arrow types into round-hole WebGL types.

There are always a number of trade-offs to be made when rendering large datasets. In this post we've explored one-way to minimise the work performed by the CPU, at the expense of some data pre-processing and network bandwidth. 

This isn't for everyone and it would definitely be valid to optimise for something else. Be that optimising for network bandwidth and burning the extra CPU cycles. Or maybe optimising for GPU capability and using some form of layered tile loading mechanism. Most likely optimising for something I've not even had to consider.

That being said, I've found it really interesting to dig deep into the data formats and find a way to effectively eliminate the parsing and transformation parts of the implementation. After all, didn't a [famous water tower builder](https://twitter.com/elonmusk/status/1154599520711266305) once say -

> No part is the best part

