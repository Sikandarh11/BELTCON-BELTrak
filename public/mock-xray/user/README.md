# User-provided mock X-ray images

The development Screening/HBSS Simulator reads static JPG and PNG files from
this directory. It previews and references the files in place; it does not
upload, encode, modify, or generate images.

## Convention

- Create one folder per image set: `set-01`, `set-02`, and so on.
- Use lowercase, descriptive filenames such as `side.jpg`, `top.jpg`, or
  `density.png`.
- Supported extensions are `.jpg`, `.jpeg`, and `.png`.
- SVG and Base64/data URLs are not supported.
- Browser paths start with `/mock-xray/user/`. For example:
  `/mock-xray/user/set-01/side.jpg`.

After adding or renaming files, add matching entries to
`src/features/simulator/mockXraySets.ts`. If no image sets are registered, the
simulator remains available for `PENDING`, `NOT_FOUND`, and `FAILED` scan
states; `AVAILABLE` requires at least one registered image.
