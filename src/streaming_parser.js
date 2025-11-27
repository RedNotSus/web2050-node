// Port of streaming_parser.rs

const OUT_TAG = "_out";

export class StreamingParser {
  constructor() {
    this.buffer = "";
    this.tagDepth = 0;
    this.topLevelTagName = null;
  }

  feed(chunk) {
    this.buffer += chunk;
    let output = "";

    while (true) {
      const start = this.buffer.indexOf('<');
      if (start === -1) {
        // No tag start found.
        // If we are currently inside the OUT_TAG, everything remaining in buffer is content.
        if (this.topLevelTagName === OUT_TAG && this.tagDepth > 0) {
          output += this.buffer;
          this.buffer = "";
        }
        break;
      }

      const relEnd = this.buffer.slice(start).indexOf('>');
      if (relEnd === -1) {
        // Tag start found but no end. Wait for more data.
        break;
      }

      const end = start + relEnd;
      // Extract the full tag string, e.g. "<div>" or "</div>"
      const rawTag = this.buffer.slice(start, end + 1);

      // Determine tag name and if closing
      // inner is content inside < >, e.g. "div" or "/div"
      const inner = rawTag.slice(1, -1);
      const isClosing = inner.startsWith('/');
      const tagName = isClosing ? inner.slice(1).trim().split(' ')[0] : inner.trim().split(' ')[0];

      // Handle content before this tag
      if (start > 0) {
        if (this.topLevelTagName === OUT_TAG && this.tagDepth > 0) {
          output += this.buffer.slice(0, start);
        }
        // Remove processed part from buffer
        // Note: in Rust `drain(..start)` removes it.
        // We will slice the buffer at the end of loop, or constructing new string.
      }

      // If we are inside OUT_TAG, and this tag is NOT the OUT_TAG itself,
      // it is part of the content we want to output (e.g. <html> inside <_out>).
      if (this.topLevelTagName === OUT_TAG && tagName !== OUT_TAG) {
        output += rawTag;
      }

      // Update state
      if (!isClosing) {
        if (this.tagDepth === 0) {
          this.topLevelTagName = tagName;
          this.tagDepth = 1;
        } else if (this.topLevelTagName === tagName) {
          this.tagDepth += 1;
        }
      } else {
        if (this.tagDepth > 0 && this.topLevelTagName === tagName) {
          this.tagDepth -= 1;
          if (this.tagDepth === 0) {
            this.topLevelTagName = null;
          }
        }
      }

      // Remove processed chunk including the tag from buffer
      this.buffer = this.buffer.slice(end + 1);
    }

    return output;
  }
}
