import { describe, expect, it } from 'vitest';
import { Parser } from './parser';
import { bytesOf } from './lexer';
import {
  PdfName,
  PdfRef,
  PdfStream,
  isArray,
  isDict,
  isName,
  isRef,
  isStream,
} from './types';

function parse(src: string) {
  return new Parser(bytesOf(src)).parseObject();
}

describe('Parser', () => {
  it('parses primitives', () => {
    expect(parse('true')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse('null')).toBe(null);
    expect(parse('3.14')).toBe(3.14);
    expect(parse('/DeviceRGB')).toBeInstanceOf(PdfName);
    expect((parse('/DeviceRGB') as PdfName).name).toBe('DeviceRGB');
  });

  it('parses an indirect reference, not two numbers', () => {
    const obj = parse('12 0 R');
    expect(isRef(obj)).toBe(true);
    expect((obj as PdfRef).num).toBe(12);
    expect((obj as PdfRef).gen).toBe(0);
  });

  it('parses a bare number followed by unrelated tokens without consuming them', () => {
    const parser = new Parser(bytesOf('42 /Next'));
    expect(parser.parseObject()).toBe(42);
    expect(isName(parser.parseObject(), 'Next')).toBe(true);
  });

  it('parses arrays with mixed element types and nested refs', () => {
    const obj = parse('[ 1 2.5 /Foo (bar) 9 0 R ]');
    expect(isArray(obj)).toBe(true);
    const arr = obj as ReturnType<Parser['parseObject']>[] & unknown[];
    expect(arr[0]).toBe(1);
    expect(arr[1]).toBe(2.5);
    expect(isName(arr[2] as never, 'Foo')).toBe(true);
    expect(isRef(arr[4] as never)).toBe(true);
  });

  it('parses a dictionary keyed by names', () => {
    const obj = parse('<< /Type /Page /Count 3 /Kids [ 1 0 R ] >>');
    expect(isDict(obj)).toBe(true);
    if (!isDict(obj)) return;
    expect(isName(obj['Type'], 'Page')).toBe(true);
    expect(obj['Count']).toBe(3);
    expect(isArray(obj['Kids'])).toBe(true);
  });

  it('parses a stream, using a direct /Length', () => {
    const body = 'hello world';
    const src = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    const obj = parse(src);
    expect(isStream(obj)).toBe(true);
    const stream = obj as PdfStream;
    expect(String.fromCharCode(...stream.raw)).toBe(body);
  });

  it('recovers stream bounds by scanning for endstream when /Length is wrong', () => {
    const body = 'abcdefghij';
    // Deliberately wrong length (3) — parser should scan to endstream instead.
    const src = `<< /Length 3 >>\nstream\n${body}\nendstream`;
    const stream = parse(src) as PdfStream;
    expect(isStream(stream)).toBe(true);
    expect(String.fromCharCode(...stream.raw)).toBe(body);
  });

  it('continues lexing after a stream (position restored past endstream)', () => {
    const src = '<< /Length 3 >>\nstream\nabc\nendstream\n/After';
    const parser = new Parser(bytesOf(src));
    const stream = parser.parseObject() as PdfStream;
    expect(String.fromCharCode(...stream.raw)).toBe('abc');
    expect(isName(parser.parseObject(), 'After')).toBe(true);
  });

  it('parses an indirect object definition at an offset', () => {
    const src = 'garbage\n7 0 obj\n<< /A 1 >>\nendobj';
    const parser = new Parser(bytesOf(src));
    const io = parser.parseIndirectObjectAt(src.indexOf('7 0 obj'));
    expect(io.num).toBe(7);
    expect(io.gen).toBe(0);
    expect(isDict(io.value)).toBe(true);
  });
});
