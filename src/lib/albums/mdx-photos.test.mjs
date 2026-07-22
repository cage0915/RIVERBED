import assert from "node:assert/strict";
import test from "node:test";

import { MdxPhotoError, extractMdxPhotos } from "./mdx-photos.ts";

test("extracts static Photo references in document order with source context", () => {
    const body = `<Row>
  <Photo itemKey="A.jpg" />
  <Photo
    caption="second"
    itemKey='B.webp'
  />
</Row>`;

    const photos = extractMdxPhotos(body);

    assert.deepEqual(photos.map(({ filename }) => filename), ["A.jpg", "B.webp"]);
    assert.deepEqual(photos.map(({ offset }) => offset), [body.indexOf("<Photo"), body.lastIndexOf("<Photo")]);
    assert.match(photos[0].context, /<Photo itemKey="A\.jpg" \/>/);
    assert.match(photos[1].context, /itemKey='B\.webp'/);
});

test("rejects a dynamic Photo itemKey", () => {
    assert.throws(
        () => extractMdxPhotos(`<Photo itemKey={photo.filename} />`),
        (error) => error instanceof MdxPhotoError &&
            error.code === "dynamic-item-key" &&
            /static quoted string/i.test(error.message),
    );
});

test("rejects a full-path Photo itemKey", () => {
    assert.throws(
        () => extractMdxPhotos(`<Photo itemKey="yama/walk/A.jpg" />`),
        (error) => error instanceof MdxPhotoError &&
            error.code === "invalid-item-key" &&
            /local filename/i.test(error.message),
    );
});

test("rejects a Photo without itemKey", () => {
    assert.throws(
        () => extractMdxPhotos(`<Photo caption="No key" />`),
        (error) => error instanceof MdxPhotoError &&
            error.code === "missing-item-key" &&
            /requires.*itemKey/i.test(error.message),
    );
});

test("rejects non-self-closing and malformed Photo forms", () => {
    for (const body of [
        `<Photo itemKey="A.jpg"></Photo>`,
        `<Photo itemKey="A.jpg">`,
        `<Photo itemKey="A.jpg" /`,
        `<Photo itemKey=A.jpg />`,
        `<Photo itemKey="A.jpg" //>`,
        `<Photo itemKey="A.jpg"caption="joined" />`,
        `<Photo caption=x itemKey="A.jpg" />`,
        `<Photo caption={caption}itemKey="A.jpg" />`,
        `<Photo caption={caption}other="joined" itemKey="A.jpg" />`,
    ]) {
        assert.throws(
            () => extractMdxPhotos(body),
            (error) => error instanceof MdxPhotoError &&
                error.code === "unsupported-photo-form" &&
                /self-closing.*quoted itemKey/i.test(error.message),
        );
    }
});

test("ignores commented Photo text and similarly prefixed component names", () => {
    const body = `{/* <Photo itemKey="mdx-comment.jpg" /> */}
{ /* <Photo itemKey="spaced-comment.jpg" /> */ }
<!-- <Photo itemKey="html-comment.jpg" /> -->
<Photo.Group itemKey="group.jpg" />
<Photo itemKey="content.jpg" />`;

    assert.deepEqual(
        extractMdxPhotos(body).map(({ filename }) => filename),
        ["content.jpg"],
    );
});

test("ignores Photo text in Markdown code and escaped markup", () => {
    const body = `Inline \`<Photo itemKey="inline.jpg" />\` example.

~~~mdx
<Photo itemKey="fenced.jpg" />
~~~

\\<Photo itemKey="escaped.jpg" />
<Photo itemKey="content.jpg" />`;

    assert.deepEqual(
        extractMdxPhotos(body).map(({ filename }) => filename),
        ["content.jpg"],
    );
});

test("ignores Photo text inside top-level MDX ESM string literals", () => {
    const body = `export const inlineExample = '<Photo itemKey="esm-inline.jpg" />'

export const multilineExample =
    "<Photo itemKey='esm-multiline.jpg' />"

<Photo itemKey="content.jpg" />`;

    assert.deepEqual(
        extractMdxPhotos(body).map(({ filename }) => filename),
        ["content.jpg"],
    );
});

test("keeps blank lines inside top-level MDX ESM expressions ignored", () => {
    const body = `export const arrayExamples = [
    '<Photo itemKey="array-first.jpg" />',

    '<Photo itemKey="array-second.jpg" />',
];

export const templateExample = \`
<Photo itemKey="template-first.jpg" />

<Photo itemKey="template-second.jpg" />
\`;

<Photo itemKey="content.jpg" />`;

    assert.deepEqual(
        extractMdxPhotos(body).map(({ filename }) => filename),
        ["content.jpg"],
    );
});
