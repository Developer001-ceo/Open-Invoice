'use client';

import { useDesignerStore } from '@/store/designer-store';
import { CanvasElement, TextProperties, TableProperties, ImageProperties, LineProperties, RectangleProperties, EllipseProperties, RectangleEffects, GradientFill, ShadowEffect, ReflectionEffect, GlowEffect, GradientStop, CellOverride, computeLineBounds, DEFAULT_EFFECTS, DEFAULT_GRADIENT_FILL, DEFAULT_SHADOW, DEFAULT_REFLECTION, DEFAULT_GLOW, GRADIENT_PRESETS, buildGradientCSS, normalizeRectBorderRadius, getRectRotation, normalizeAngle } from '@/lib/element-types';
import { hasCustomCorners } from '@/lib/rectangle-corners';
import { ensureColWidths, ensureRowHeights, ensureRowNames, ensureColNames } from '@/lib/table-helpers';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { NumericField } from '@/components/ui/numeric-field';
import { SliderField } from '@/components/ui/slider-field';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GradientStopBar } from '@/components/designer/gradient-stop-bar';
import { DraggableReorderList, ReorderItem } from '@/components/designer/draggable-reorder-list';
import { Switch } from '@/components/ui/switch';
import { ColorInput } from '@/components/ui/color-input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FONT_FAMILIES, FONT_FAMILIES_GROUPED, DEFAULT_FONT_FAMILY } from '@/lib/fonts';
import {
  Trash2,
  Copy,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ArrowUpToLine,
  ArrowDownToLine,
  Type,
  Table,
  Image as ImageIcon,
  Minus,
  Square,
  Circle,
  Plus,
  X,
  Link,
  Link2Off,
  ChevronRight as ChevronRightIcon,
  Search,
  Crosshair,
  AlignCenterHorizontal,
  AlignCenterVertical,
  PanelTop,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Grid3x3,
  Palette,
  Sun,
  Sparkles,
  Layers,
  RotateCw,
  Columns3,
  Rows3,
  RotateCcw,
} from 'lucide-react';
import { useRef, useState, createContext, useContext, useMemo, useCallback, memo, useEffect } from 'react';
import { FormattingToolbar } from '@/components/designer/rich-text-editor';
import { StaticFormattingToolbar } from '@/components/designer/floating-card';

// ---- Debounced update hook ----
// Debounces rapid numeric input changes so the store isn't updated on every keystroke.
function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  // Update the callback ref in an effect to avoid accessing ref during render
  useEffect(() => {
    callbackRef.current = callback;
  });
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callbackRef.current(...args), delay);
    },
    [delay],
  ) as T;
}

// ---- Remap helpers for row/col swap ----

function remapOverridesForRowSwap(
  overrides: Record<string, CellOverride>,
  rowA: number,
  rowB: number
): Record<string, CellOverride> {
  const result: Record<string, CellOverride> = {};
  for (const [key, val] of Object.entries(overrides)) {
    const [r, c] = key.split('-').map(Number);
    let newR = r;
    if (r === rowA) newR = rowB;
    else if (r === rowB) newR = rowA;
    result[`${newR}-${c}`] = val;
  }
  return result;
}

function remapOverridesForColSwap(
  overrides: Record<string, CellOverride>,
  colA: number,
  colB: number
): Record<string, CellOverride> {
  const result: Record<string, CellOverride> = {};
  for (const [key, val] of Object.entries(overrides)) {
    const [r, c] = key.split('-').map(Number);
    let newC = c;
    if (c === colA) newC = colB;
    else if (c === colB) newC = colA;
    result[`${r}-${newC}`] = val;
  }
  return result;
}

function remapRowBgForSwap(
  rowBg: Record<number, string>,
  rowA: number,
  rowB: number
): Record<number, string> {
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(rowBg)) {
    const r = Number(k);
    let newR = r;
    if (r === rowA) newR = rowB;
    else if (r === rowB) newR = rowA;
    result[newR] = v;
  }
  return result;
}

function remapColBgForSwap(
  colBg: Record<number, string>,
  colA: number,
  colB: number
): Record<number, string> {
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(colBg)) {
    const c = Number(k);
    let newC = c;
    if (c === colA) newC = colB;
    else if (c === colB) newC = colA;
    result[newC] = v;
  }
  return result;
}

// Remap overrides when a row/col is moved from `fromIndex` to `toIndex` (arbitrary distance)
function remapOverridesForInsertion(
  overrides: Record<string, CellOverride>,
  fromIndex: number,
  toIndex: number,
  axis: 'row' | 'col'
): Record<string, CellOverride> {
  if (fromIndex === toIndex) return overrides;
  const result: Record<string, CellOverride> = {};
  for (const [key, val] of Object.entries(overrides)) {
    const [r, c] = key.split('-').map(Number);
    let newIdx = axis === 'row' ? r : c;
    if (newIdx === fromIndex) {
      newIdx = toIndex;
    } else if (fromIndex < toIndex) {
      // Moving down/right: shift items between from+1 and to up/left by 1
      if (newIdx > fromIndex && newIdx <= toIndex) newIdx -= 1;
    } else {
      // Moving up/left: shift items between to and from-1 down/right by 1
      if (newIdx >= toIndex && newIdx < fromIndex) newIdx += 1;
    }
    const newKey = axis === 'row' ? `${newIdx}-${c}` : `${r}-${newIdx}`;
    result[newKey] = val;
  }
  return result;
}

function remapRowBgForInsertion(
  rowBg: Record<number, string>,
  fromIndex: number,
  toIndex: number
): Record<number, string> {
  if (fromIndex === toIndex) return rowBg;
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(rowBg)) {
    const r = Number(k);
    let newR = r;
    if (r === fromIndex) {
      newR = toIndex;
    } else if (fromIndex < toIndex) {
      if (r > fromIndex && r <= toIndex) newR -= 1;
    } else {
      if (r >= toIndex && r < fromIndex) newR += 1;
    }
    result[newR] = v;
  }
  return result;
}

function remapColBgForInsertion(
  colBg: Record<number, string>,
  fromIndex: number,
  toIndex: number
): Record<number, string> {
  if (fromIndex === toIndex) return colBg;
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(colBg)) {
    const c = Number(k);
    let newC = c;
    if (c === fromIndex) {
      newC = toIndex;
    } else if (fromIndex < toIndex) {
      if (c > fromIndex && c <= toIndex) newC -= 1;
    } else {
      if (c >= toIndex && c < fromIndex) newC += 1;
    }
    result[newC] = v;
  }
  return result;
}

const typeIcons: Record<string, React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  table: <Table className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
  line: <Minus className="h-4 w-4" />,
  rectangle: <Square className="h-4 w-4" />,
  ellipse: <Circle className="h-4 w-4" />,
};

// Compact labeled input — label above the input for full-width value visibility
function PropertyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

// Inline row for small paired fields (like X/Y, W/H)
function PropertyPair({ label1, child1, label2, child2 }: {
  label1: string; child1: React.ReactNode;
  label2: string; child2: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <PropertyField label={label1}>{child1}</PropertyField>
      <PropertyField label={label2}>{child2}</PropertyField>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2 first:mt-0 first:mb-2">
      {children}
    </div>
  );
}

// ─── Search Context ──────────────────────────────────────────────────────
// Provides the active search term so sections can auto-show when matching
const SearchContext = createContext('');
function useSearchTerm() {
  return useContext(SearchContext);
}

// ─── Accordion Section ───────────────────────────────────────────────────
// Replaces SectionTitle with a collapsible card wrapper.
// - Collapsible with smooth animation (Suggestion 1)
// - Visual card container (Suggestion 6)
// - Auto-expands when search term matches the label (Suggestion 7)
// - `defaultOpen` controls initial state; rarely-used sections default to closed
// - `keywords` allows search to match additional terms beyond the label
function AccordionSection({
  label,
  defaultOpen = false,
  forceOpen = false,
  keywords,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  keywords?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const searchTerm = useSearchTerm();

  // Auto-expand when search matches the label or keywords
  const searchText = [label, keywords].filter(Boolean).join(' ').toLowerCase();
  const matchesSearch = searchTerm
    ? searchText.includes(searchTerm.toLowerCase())
    : false;

  // If search is active and matches, force open; if search is active but doesn't match, force closed
  // If forceOpen is true, always keep open
  const effectiveOpen = searchTerm ? matchesSearch : (forceOpen || isOpen);

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden"
      data-section-label={label.toLowerCase()}
    >
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-muted/40 transition-colors duration-150"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRightIcon
          className={`h-3 w-3 text-muted-foreground/60 shrink-0 transition-transform duration-200 ${
            effectiveOpen ? 'rotate-90' : ''
          }`}
        />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.33,1,0.68,1)]"
        style={{ gridTemplateRows: effectiveOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Search Bar ──────────────────────────────────────────────────────────
// A compact search input that filters visible property sections (Suggestion 7)
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search properties..."
        className="w-full h-7 text-[11px] pl-6 pr-6 bg-muted/30 border border-border/60 rounded-md
          focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring
          placeholder:text-muted-foreground/40 transition-colors duration-150"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-sm hover:bg-muted flex items-center justify-center"
        >
          <X className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// Position & Size Properties
function TransformProperties({ element }: { element: CanvasElement }) {
  const updateElement = useDesignerStore((s) => s.updateElement);
  const alignElementHorizontalCenter = useDesignerStore((s) => s.alignElementHorizontalCenter);
  const alignElementVerticalCenter = useDesignerStore((s) => s.alignElementVerticalCenter);

  // Debounced position/size updates to avoid store churn on every keystroke
  const debouncedUpdatePosition = useDebouncedCallback(
    (field: 'x' | 'y', value: number) => updateElement(element.id, { [field]: value }),
    150,
  );
  const debouncedUpdateSize = useDebouncedCallback(
    (field: 'width' | 'height', value: number) => updateElement(element.id, { [field]: Math.max(10, value) }),
    150,
  );

  const handleAlignHCenter = useCallback(
    () => alignElementHorizontalCenter(element.id),
    [alignElementHorizontalCenter, element.id],
  );
  const handleAlignVCenter = useCallback(
    () => alignElementVerticalCenter(element.id),
    [alignElementVerticalCenter, element.id],
  );

  // For line elements, skip the standard position/size section
  // (lines use endpoint coordinates managed by LinePropertiesPanel)
  if (element.type === 'line') {
    return (
      <>
        <AccordionSection label="Alignment" keywords="center horizontal vertical align">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] flex-1 gap-1"
              onClick={handleAlignHCenter}
              title="Center horizontally on page"
            >
              <AlignCenterVertical className="h-3 w-3" /> H-Center
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] flex-1 gap-1"
              onClick={handleAlignVCenter}
              title="Center vertically on page"
            >
              <AlignCenterHorizontal className="h-3 w-3" /> V-Center
            </Button>
          </div>
        </AccordionSection>
      </>
    );
  }

  return (
    <>
      <AccordionSection label="Alignment" keywords="center horizontal vertical align">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] flex-1 gap-1"
            onClick={handleAlignHCenter}
            title="Center horizontally on page"
          >
            <AlignCenterVertical className="h-3 w-3" /> H-Center
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] flex-1 gap-1"
            onClick={handleAlignVCenter}
            title="Center vertically on page"
          >
            <AlignCenterHorizontal className="h-3 w-3" /> V-Center
          </Button>
        </div>
      </AccordionSection>
      <AccordionSection label="Position" keywords="x y location coordinates" defaultOpen={false}>
        <PropertyPair
          label1="X"
          child1={
            <Input
              type="number"
              value={Math.round(element.x)}
              onChange={(e) => debouncedUpdatePosition('x', +e.target.value)}
              className="h-7 text-xs"
            />
          }
          label2="Y"
          child2={
            <Input
              type="number"
              value={Math.round(element.y)}
              onChange={(e) => debouncedUpdatePosition('y', +e.target.value)}
              className="h-7 text-xs"
            />
          }
        />
      </AccordionSection>
      <AccordionSection label="Size" keywords="width height dimensions w h">
        <PropertyPair
          label1="Width"
          child1={
            <Input
              type="number"
              value={Math.round(element.width)}
              onChange={(e) => debouncedUpdateSize('width', +e.target.value)}
              className="h-7 text-xs"
            />
          }
          label2="Height"
          child2={
            <Input
              type="number"
              value={Math.round(element.height)}
              onChange={(e) => debouncedUpdateSize('height', +e.target.value)}
              className="h-7 text-xs"
            />
          }
        />
      </AccordionSection>
    </>
  );
}

// Text Properties — base/default formatting for text elements
// Note: Per-character formatting is now available via the canvas text editor
// (double-click a text element). These properties serve as the element-wide defaults.
function TextPropertiesPanel({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'text'; data: TextProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const editingTextElementId = useDesignerStore((s) => s.editingTextElementId);
  const activeTextEditor = useDesignerStore((s) => s.activeTextEditor);

  const isEditing = editingTextElementId === element.id;

  const update = useCallback((updates: Partial<TextProperties>) => {
    let finalUpdates = updates;
    // When textAlign is changed, apply it to the entire content
    if (updates.textAlign) {
      if (isEditing && activeTextEditor) {
        // While editing: use TipTap's setTextAlign to update all paragraphs
        activeTextEditor.chain().focus().setTextAlign(updates.textAlign).run();
      } else {
        // While not editing: update the HTML content directly to change/add
        // text-align on all block-level elements (p, h1-h6, li, etc.)
        const align = updates.textAlign;
        let updatedContent = props.content;
        // Step 1: For tags with style="..." — replace or add text-align
        updatedContent = updatedContent.replace(
          /(<(?:p|h[1-6]|li|div|blockquote)[^>]*?style=")([^"]*)(")/gi,
          (_match, styleStart: string, styleContent: string, styleEnd: string) => {
            if (styleContent.includes('text-align')) {
              // Replace existing text-align value
              return `${styleStart}${styleContent.replace(/text-align:\s*[^;"]+/gi, `text-align: ${align}`)}${styleEnd}`;
            }
            // Add text-align to existing style
            const sep = styleContent && !styleContent.endsWith(';') ? ';' : '';
            return `${styleStart}${styleContent}${sep}text-align: ${align}${styleEnd}`;
          }
        );
        // Step 2: For tags without any style attribute — add style="text-align: X"
        updatedContent = updatedContent.replace(
          /<(p|h[1-6]|li|div|blockquote)(\s[^>]*?)?>/gi,
          (match, tag: string, attrs: string | undefined) => {
            if (attrs && attrs.includes('style=')) return match; // already handled in step 1
            return `<${tag}${attrs || ''} style="text-align: ${align}">`;
          }
        );
        finalUpdates = { ...updates, content: updatedContent };
      }
    }
    updateElementProperties(element.id, {
      type: 'text',
      data: { ...props, ...finalUpdates },
    });
  }, [element.id, props, updateElementProperties, isEditing, activeTextEditor]);

  return (
    <>
      {/* Text Formatting section — always visible with formatting controls */}
      <AccordionSection label="Default Alignment & Spacing" keywords="align left center right justify line height letter spacing default base">
        <PropertyField label="Align">
          <Select value={props.textAlign} onValueChange={(v) => update({ textAlign: v as 'left' | 'center' | 'right' | 'justify' })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="right">Right</SelectItem>
              <SelectItem value="justify">Justify</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Line Height">
          <SliderField
            value={[props.lineHeight * 100]}
            min={80}
            max={300}
            step={10}
            unit="%"
            colorTheme="green"
            onValueChange={([v]) => update({ lineHeight: v / 100 })}
            className="flex-1"
          />
        </PropertyField>
        <PropertyField label="Letter Spacing">
          <SliderField
            value={[props.letterSpacing]}
            min={-5}
            max={20}
            step={0.5}
            unit="px"
            colorTheme="teal"
            onValueChange={([v]) => update({ letterSpacing: v })}
            className="flex-1"
          />
        </PropertyField>
      </AccordionSection>

      <AccordionSection label="Default Color" keywords="text color opacity default base">
        <PropertyField label="Color">
          <ColorInput value={props.color} onChange={(v) => update({ color: v })} />
        </PropertyField>
        <PropertyField label="Opacity">
          <SliderField
            value={[props.opacity * 100]}
            min={0}
            max={100}
            step={1}
            unit="%"
            colorTheme="gray"
            onValueChange={([v]) => update({ opacity: v / 100 })}
            className="flex-1"
          />
        </PropertyField>
      </AccordionSection>
      <AccordionSection label="Default Typography" keywords="font size family weight style decoration transform uppercase lowercase capitalize default base">
        <p className="text-[9px] text-muted-foreground -mt-1 mb-1">Base styles applied to all text. Use inline editor for per-character formatting.</p>
        <PropertyField label="Font Size">
          <SliderField
            value={[props.fontSize]}
            min={6}
            max={100}
            step={1}
            unit="px"
            colorTheme="purple"
            onValueChange={([v]) => update({ fontSize: v })}
            className="flex-1"
          />
        </PropertyField>
        <PropertyField label="Font Family">
          <Select value={props.fontFamily} onValueChange={(v) => update({ fontFamily: v })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES_GROUPED.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">{group.label}</SelectLabel>
                  {group.options.map((f) => (
                    <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Weight">
          <Select value={props.fontWeight} onValueChange={(v) => update({ fontWeight: v })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="bold">Bold</SelectItem>
              <SelectItem value="lighter">Lighter</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="300">300</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="700">700</SelectItem>
              <SelectItem value="900">900</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Style">
          <Select value={props.fontStyle} onValueChange={(v) => update({ fontStyle: v })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="italic">Italic</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Decoration">
          <Select value={props.textDecoration} onValueChange={(v) => update({ textDecoration: v })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="underline">Underline</SelectItem>
              <SelectItem value="line-through">Strikethrough</SelectItem>
              <SelectItem value="overline">Overline</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Transform">
          <Select value={props.textTransform} onValueChange={(v) => update({ textTransform: v as 'none' | 'uppercase' | 'lowercase' | 'capitalize' })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="uppercase">UPPERCASE</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="capitalize">Capitalize</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
      </AccordionSection>

      <AccordionSection label="Formatting" keywords="format bold italic underline strike font size family color alignment letter spacing list bullet numbered" defaultOpen={true}>
        {isEditing ? (
          <FormattingToolbar editor={activeTextEditor} baseProps={props} />
        ) : (
          <StaticFormattingToolbar data={props} update={update} />
        )}
      </AccordionSection>

    </>
  );
}

// Table Properties — comprehensive panel
function TablePropertiesPanel({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);

  // Sync with store's Alt-key cell selection from the canvas.
  // Only reflect the store selection when it belongs to THIS table — the
  // store tracks tableCellSelectTableId so selections stay scoped per table
  // (otherwise cells at the same {row, col} in other tables would light up).
  const storeSelectedTableCells = useDesignerStore((s) => s.selectedTableCells);
  const tableCellSelectTableId = useDesignerStore((s) => s.tableCellSelectTableId);
  // Only reflect the store selection when it belongs to THIS table. Memoized
  // so the dependency identity stays stable for useCallback/useMemo below.
  const storeSelectionForThisTable = useMemo(
    () => (tableCellSelectTableId === element.id ? storeSelectedTableCells : []),
    [tableCellSelectTableId, element.id, storeSelectedTableCells]
  );

  const [localSelectedCells, setLocalSelectedCells] = useState<Set<string>>(new Set());
  const [removeRowIdx, setRemoveRowIdx] = useState<number>(0);
  const [removeColIdx, setRemoveColIdx] = useState<number>(0);

  // Merge store's canvas cell selection with panel's local selection.
  // Store selection takes priority when present (from Alt+click on canvas).
  const selectedCells = storeSelectionForThisTable.length > 0
    ? new Set(storeSelectionForThisTable.map(cell => `${cell.row}-${cell.col}`))
    : localSelectedCells;

  // Wrapper for setSelectedCells that updates local state and clears store selection
  const setSelectedCells = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    // Clear store selection when using the panel mini-table to select
    if (storeSelectionForThisTable.length > 0) {
      useDesignerStore.getState().clearTableCellSelection();
    }
    setLocalSelectedCells((prev) => {
      const resolved = typeof updater === 'function' ? updater(storeSelectionForThisTable.length > 0 ? new Set(storeSelectionForThisTable.map(cell => `${cell.row}-${cell.col}`)) : prev) : updater;
      return resolved;
    });
  }, [storeSelectionForThisTable]);
  // Migrate legacy showOuterBorder/showInnerBorder to per-side borders
  const legacyOuter = rawProps.showOuterBorder;
  const legacyInner = rawProps.showInnerBorder;

  // Provide defaults for backward compatibility — memoized to stabilize the `update` closure
  const props: TableProperties = useMemo(() => ({
    rows: rawProps.rows ?? 4,
    cols: rawProps.cols ?? 3,
    cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
    cellOverrides: rawProps.cellOverrides ?? {},
    showHeader: rawProps.showHeader ?? true,
    headerBg: rawProps.headerBg ?? '#f3f4f6',
    headerColor: rawProps.headerColor ?? '#111827',
    headerFontWeight: rawProps.headerFontWeight ?? 'bold',
    cellBg: rawProps.cellBg ?? '#ffffff',
    cellColor: rawProps.cellColor ?? '#374151',
    cellPadding: rawProps.cellPadding ?? 8,
    fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
    fontSize: rawProps.fontSize ?? 13,
    rowBgColors: rawProps.rowBgColors ?? {},
    colBgColors: rawProps.colBgColors ?? {},
    borderWidth: rawProps.borderWidth ?? 1,
    borderStyle: rawProps.borderStyle ?? 'solid',
    borderColor: rawProps.borderColor ?? '#d1d5db',
    showBorderTop: rawProps.showBorderTop ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderRight: rawProps.showBorderRight ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderBottom: rawProps.showBorderBottom ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderLeft: rawProps.showBorderLeft ?? (legacyOuter !== undefined ? legacyOuter : true),
    showInnerBorders: rawProps.showInnerBorders ?? (legacyInner !== undefined ? legacyInner : true),
    cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
    rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
    rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
    colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
    opacity: rawProps.opacity ?? 1,
  }), [rawProps, legacyOuter, legacyInner]);

  const update = useCallback((updates: Partial<TableProperties>) => {
    // Always read the latest element data from the store to avoid stale closure issues.
    // This ensures that if the user adjusted row/column sizes via drag handles
    // (which update the store directly), those changes are preserved when updating
    // other properties like cornerRadius.
    const currentElement = useDesignerStore.getState().elements.find((el) => el.id === element.id);
    const currentData = currentElement
      ? (currentElement.properties as { type: 'table'; data: TableProperties }).data
      : props;
    updateElementProperties(element.id, {
      type: 'table',
      data: { ...currentData, ...updates },
    });
  }, [element.id, props, updateElementProperties]);

  // ---- Structure helpers ----

  const addRow = () => {
    // Read latest data from store to avoid stale closure issues
    const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
    const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
    const newRow = Array(currentData.cols).fill('');
    const newCellData = [...currentData.cellData.map((r) => [...r]), newRow];
    const newRowHeights = [...(currentData.rowHeights ?? Array(currentData.rows).fill(1)), 1];
    const newRowNames = [...(currentData.rowNames ?? Array.from({ length: currentData.rows }, (_, i) => `Row ${i + 1}`)), `Row ${currentData.rows + 1}`];
    update({ rows: currentData.rows + 1, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
  };

  const addColumn = () => {
    // Read latest data from store to avoid stale closure issues
    const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
    const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
    const newCellData = currentData.cellData.map((row) => [...row, '']);
    const newColWidths = [...(currentData.colWidths ?? Array(currentData.cols).fill(1)), 1];
    const newColNames = [...(currentData.colNames ?? Array.from({ length: currentData.cols }, (_, i) => `Column ${i + 1}`)), `Column ${currentData.cols + 1}`];
    update({ cols: currentData.cols + 1, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
  };

  const removeRow = (idx: number) => {
    if (props.rows <= 1) return;
    const newCellData = props.cellData.filter((_, i) => i !== idx);
    // Shift cellOverrides keys
    const newOverrides: Record<string, CellOverride> = {};
    for (const [key, val] of Object.entries(props.cellOverrides)) {
      const [r, c] = key.split('-').map(Number);
      if (r === idx) continue; // drop overrides for removed row
      const newR = r > idx ? r - 1 : r;
      newOverrides[`${newR}-${c}`] = val;
    }
    // Shift rowBgColors
    const newRowBg: Record<number, string> = {};
    for (const [k, v] of Object.entries(props.rowBgColors)) {
      const r = Number(k);
      if (r === idx) continue;
      const newR = r > idx ? r - 1 : r;
      newRowBg[newR] = v;
    }
    // Remove the row height entry at idx
    const rowHeights = props.rowHeights ?? Array(props.rows).fill(1);
    const newRowHeights = rowHeights.filter((_, i) => i !== idx);
    const newRowNames = (props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`)).filter((_, i) => i !== idx);
    update({ rows: props.rows - 1, cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowHeights: newRowHeights, rowNames: newRowNames });
    setRemoveRowIdx(Math.max(0, Math.min(removeRowIdx, props.rows - 2)));
  };

  const removeColumn = (idx: number) => {
    if (props.cols <= 1) return;
    const newCellData = props.cellData.map((row) => row.filter((_, i) => i !== idx));
    // Shift cellOverrides keys
    const newOverrides: Record<string, CellOverride> = {};
    for (const [key, val] of Object.entries(props.cellOverrides)) {
      const [r, c] = key.split('-').map(Number);
      if (c === idx) continue;
      const newC = c > idx ? c - 1 : c;
      newOverrides[`${r}-${newC}`] = val;
    }
    // Shift colBgColors
    const newColBg: Record<number, string> = {};
    for (const [k, v] of Object.entries(props.colBgColors)) {
      const c = Number(k);
      if (c === idx) continue;
      const newC = c > idx ? c - 1 : c;
      newColBg[newC] = v;
    }
    // Remove the col width entry at idx
    const colWidths = props.colWidths ?? Array(props.cols).fill(1);
    const newColWidths = colWidths.filter((_, i) => i !== idx);
    const newColNames = (props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`)).filter((_, i) => i !== idx);
    update({ cols: props.cols - 1, cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colWidths: newColWidths, colNames: newColNames });
    setRemoveColIdx(Math.max(0, Math.min(removeColIdx, props.cols - 2)));
  };

  // Drag-and-drop reorder handlers (arbitrary from→to, not just adjacent)
  const handleRowReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCellData = props.cellData.map((r) => [...r]);
    const [moved] = newCellData.splice(fromIndex, 1);
    newCellData.splice(toIndex, 0, moved);
    // Remap cellOverrides: shift all row keys
    const newOverrides = remapOverridesForInsertion(props.cellOverrides, fromIndex, toIndex, 'row');
    const newRowBg = remapRowBgForInsertion(props.rowBgColors, fromIndex, toIndex);
    // Reorder rowHeights
    const rowHeights = props.rowHeights ?? Array(props.rows).fill(1);
    const newRowHeights = [...rowHeights];
    const [movedH] = newRowHeights.splice(fromIndex, 1);
    newRowHeights.splice(toIndex, 0, movedH);
    // Reorder rowNames
    const rowNames = [...(props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`))];
    const [movedRowName] = rowNames.splice(fromIndex, 1);
    rowNames.splice(toIndex, 0, movedRowName);
    update({ cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowHeights: newRowHeights, rowNames });
  }, [props.cellData, props.cellOverrides, props.rowBgColors, props.rowHeights, props.rowNames, props.rows, update]);

  const handleColReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCellData = props.cellData.map((row) => {
      const newRow = [...row];
      const [moved] = newRow.splice(fromIndex, 1);
      newRow.splice(toIndex, 0, moved);
      return newRow;
    });
    const newOverrides = remapOverridesForInsertion(props.cellOverrides, fromIndex, toIndex, 'col');
    const newColBg = remapColBgForInsertion(props.colBgColors, fromIndex, toIndex);
    // Reorder colWidths
    const colWidths = props.colWidths ?? Array(props.cols).fill(1);
    const newColWidths = [...colWidths];
    const [movedW] = newColWidths.splice(fromIndex, 1);
    newColWidths.splice(toIndex, 0, movedW);
    // Reorder colNames
    const colNames = [...(props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`))];
    const [movedColName] = colNames.splice(fromIndex, 1);
    colNames.splice(toIndex, 0, movedColName);
    update({ cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colWidths: newColWidths, colNames });
  }, [props.cellData, props.cellOverrides, props.colBgColors, props.colWidths, props.colNames, props.cols, update]);

  // ---- Cell override helpers ----

  const getCellOverride = (r: number, c: number): CellOverride => {
    return props.cellOverrides[`${r}-${c}`] || {};
  };

  const updateCellOverride = (r: number, c: number, overrideUpdate: Partial<CellOverride>) => {
    const key = `${r}-${c}`;
    const existing = props.cellOverrides[key] || {};
    const merged = { ...existing, ...overrideUpdate };
    // Remove keys with undefined values
    const cleaned: CellOverride = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined) (cleaned as Record<string, unknown>)[k] = v;
    }
    const newOverrides = { ...props.cellOverrides, [key]: cleaned };
    // If override is empty, remove the key
    if (Object.keys(cleaned).length === 0) {
      delete newOverrides[key];
    }
    update({ cellOverrides: newOverrides });
  };

  const clearCellOverride = (r: number, c: number) => {
    const key = `${r}-${c}`;
    const newOverrides = { ...props.cellOverrides };
    delete newOverrides[key];
    update({ cellOverrides: newOverrides });
  };

  // ---- Multi-cell helpers ----

  const toggleCellSelection = (r: number, c: number, multi: boolean) => {
    const key = `${r}-${c}`;
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (multi) {
        // Shift/Ctrl+Click: toggle this cell in the selection
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      } else {
        // Normal click: if this cell is already the only one selected, keep it;
        // otherwise select only this cell
        if (next.size === 1 && next.has(key)) {
          return prev; // already the only selection
        }
        next.clear();
        next.add(key);
      }
      return next;
    });
  };

  const parseCellKey = (key: string): { r: number; c: number } => {
    const [r, c] = key.split('-').map(Number);
    return { r, c };
  };

  // Update an override property for all selected cells at once
  const updateSelectedCellsOverride = (overrideUpdate: Partial<CellOverride>) => {
    const newOverrides = { ...props.cellOverrides };
    for (const key of selectedCells) {
      const existing = newOverrides[key] || {};
      const merged = { ...existing, ...overrideUpdate };
      // Remove keys with undefined values
      const cleaned: CellOverride = {};
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined) (cleaned as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(cleaned).length === 0) {
        delete newOverrides[key];
      } else {
        newOverrides[key] = cleaned;
      }
    }
    update({ cellOverrides: newOverrides });
  };

  // Clear overrides for all selected cells
  const clearSelectedCellsOverrides = () => {
    const newOverrides = { ...props.cellOverrides };
    for (const key of selectedCells) {
      delete newOverrides[key];
    }
    update({ cellOverrides: newOverrides });
  };

  // Compute the common value of a property across all selected cells.
  // Returns { value, mixed } where mixed=true means cells have different values.
  const getMultiCellValue = <T,>(
    getter: (r: number, c: number) => T,
    fallback: T
  ): { value: T; mixed: boolean } => {
    if (selectedCells.size === 0) return { value: fallback, mixed: false };
    const values: T[] = [];
    for (const key of selectedCells) {
      const { r, c } = parseCellKey(key);
      values.push(getter(r, c));
    }
    const first = values[0];
    const mixed = values.some((v) => v !== first);
    return { value: mixed ? fallback : first, mixed };
  };

  // ---- Linked cell border toggle ----
  // When toggling a cell border side, also toggle the adjacent cell's opposite side
  const toggleCellBorderLinked = (r: number, c: number, side: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft') => {
    const current = getCellOverride(r, c);
    const currentVal = current[side] ?? true;
    const newVal = !currentVal;

    // Build batch override updates for both the cell and its neighbor
    const newOverrides = { ...props.cellOverrides };

    // Update the target cell
    const targetKey = `${r}-${c}`;
    const targetExisting = newOverrides[targetKey] || {};
    const targetMerged = { ...targetExisting, [side]: newVal };
    const targetCleaned: CellOverride = {};
    for (const [k, v] of Object.entries(targetMerged)) {
      if (v !== undefined) (targetCleaned as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(targetCleaned).length === 0) {
      delete newOverrides[targetKey];
    } else {
      newOverrides[targetKey] = targetCleaned;
    }

    // Determine adjacent cell and its opposite side
    let adjR = r;
    let adjC = c;
    let adjSide: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft' = side;

    switch (side) {
      case 'borderTop':
        adjR = r - 1;
        adjSide = 'borderBottom';
        break;
      case 'borderBottom':
        adjR = r + 1;
        adjSide = 'borderTop';
        break;
      case 'borderLeft':
        adjC = c - 1;
        adjSide = 'borderRight';
        break;
      case 'borderRight':
        adjC = c + 1;
        adjSide = 'borderLeft';
        break;
    }

    // Only update adjacent cell if it exists (not out of bounds)
    if (adjR >= 0 && adjR < props.rows && adjC >= 0 && adjC < props.cols) {
      const adjKey = `${adjR}-${adjC}`;
      const adjExisting = newOverrides[adjKey] || {};
      const adjMerged = { ...adjExisting, [adjSide]: newVal };
      const adjCleaned: CellOverride = {};
      for (const [k, v] of Object.entries(adjMerged)) {
        if (v !== undefined) (adjCleaned as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(adjCleaned).length === 0) {
        delete newOverrides[adjKey];
      } else {
        newOverrides[adjKey] = adjCleaned;
      }
    }

    update({ cellOverrides: newOverrides });
  };

  // Computed override values for selected cells (supports multi-select)
  const multiAlign = getMultiCellValue(
    (r, c) => getCellOverride(r, c).textAlign ?? 'left',
    'left'
  );
  const multiVAlign = getMultiCellValue(
    (r, c) => getCellOverride(r, c).verticalAlign ?? 'middle',
    'middle'
  );
  const multiPadding = getMultiCellValue(
    (r, c) => getCellOverride(r, c).padding ?? props.cellPadding,
    props.cellPadding
  );
  const multiBgColor = getMultiCellValue(
    (r, c) => getCellOverride(r, c).bgColor || props.cellBg,
    props.cellBg
  );
  const multiTextColor = getMultiCellValue(
    (r, c) => getCellOverride(r, c).color || props.cellColor,
    props.cellColor
  );
  const multiFontWeight = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontWeight || 'normal',
    'normal'
  );
  const multiFontFamily = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontFamily || props.fontFamily || 'Inter, sans-serif',
    props.fontFamily || 'Inter, sans-serif'
  );
  const multiFontSize = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontSize || props.fontSize,
    props.fontSize
  );
  const multiTextTransform = getMultiCellValue(
    (r, c) => getCellOverride(r, c).textTransform || 'none',
    'none'
  );

  return (
    <>
      {/* ===== STRUCTURE ===== */}
      <AccordionSection label="Appearance" keywords="opacity visibility">
      <PropertyField label="Opacity">
        <SliderField
          value={[props.opacity * 100]}
          min={0}
          max={100}
          step={1}
          unit="%"
          colorTheme="gray"
          onValueChange={([v]) => update({ opacity: v / 100 })}
          className="flex-1"
        />
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Cell Defaults" keywords="background padding font size text color">
      <PropertyField label="Background">
        <ColorInput value={props.cellBg} onChange={(v) => update({ cellBg: v })} />
      </PropertyField>
      <PropertyField label="Text Color">
        <ColorInput value={props.cellColor} onChange={(v) => update({ cellColor: v })} />
      </PropertyField>
      <PropertyField label="Padding">
        <NumericField
          value={[props.cellPadding]}
          min={0}
          max={20}
          step={1}
          onValueChange={([v]) => update({ cellPadding: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Font Size">
        <SliderField
          value={[props.fontSize]}
          min={6}
          max={100}
          step={1}
          unit="px"
          colorTheme="purple"
          onValueChange={([v]) => update({ fontSize: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Font Family">
        <Select value={props.fontFamily} onValueChange={(v) => update({ fontFamily: v })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES_GROUPED.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">{group.label}</SelectLabel>
                {group.options.map((f) => (
                  <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Cell Properties" keywords="cell override align padding background border multi select" defaultOpen={false}>
      <p className="text-[9px] text-muted-foreground mb-1">Click to select · Shift/Ctrl+Click to multi-select</p>
      <div className="max-h-52 overflow-auto border border-border rounded-md">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {props.cellData.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const cellKey = `${r}-${c}`;
                  const isSelected = selectedCells.has(cellKey);
                  const isHeader = r === 0 && props.showHeader;
                  return (
                    <td
                      key={c}
                      className={`border border-border p-0 cursor-pointer ${
                        isSelected ? 'bg-black/10 ring-1 ring-black/30' : 'hover:bg-muted/50'
                      }`}
                      onClick={(e) => toggleCellSelection(r, c, e.shiftKey || e.ctrlKey || e.metaKey)}
                    >
                      <input
                        value={cell}
                        onChange={(e) => {
                          const newCellData = props.cellData.map((r2) => [...r2]);
                          newCellData[r][c] = e.target.value;
                          update({ cellData: newCellData });
                        }}
                        className="w-full text-[10px] p-1 bg-transparent outline-none truncate"
                        style={{
                          fontWeight: isHeader ? props.headerFontWeight : 'normal',
                          color: isHeader ? props.headerColor : props.cellColor,
                          minWidth: props.cols <= 4 ? 50 : 36,
                        }}
                        onClick={(e) => { e.stopPropagation(); toggleCellSelection(r, c, e.shiftKey || e.ctrlKey || e.metaKey); }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== SELECTED CELLS PROPERTIES ===== */}
      {selectedCells.size > 0 && (
        <div className="space-y-2 p-2 border border-border rounded-md bg-muted/20 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">
              {selectedCells.size === 1
                ? `Cell (${parseCellKey([...selectedCells][0]).r + 1}, ${parseCellKey([...selectedCells][0]).c + 1})`
                : `${selectedCells.size} cells selected`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[9px] text-destructive hover:text-destructive px-1"
              onClick={clearSelectedCellsOverrides}
            >
              Reset
            </Button>
          </div>

          {/* Cell text — only shown for single selection */}
          {selectedCells.size === 1 && (() => {
            const { r, c } = parseCellKey([...selectedCells][0]);
            return (
              <PropertyField label="Text">
                <Input
                  value={props.cellData[r]?.[c] ?? ''}
                  onChange={(e) => {
                    const newCellData = props.cellData.map((r2) => [...r2]);
                    newCellData[r][c] = e.target.value;
                    update({ cellData: newCellData });
                  }}
                  className="h-7 text-xs"
                />
              </PropertyField>
            );
          })()}

          <PropertyField label="H-Align">
            <Select
              value={multiAlign.mixed ? '__mixed__' : multiAlign.value}
              onValueChange={(v) => { if (v !== '__mixed__') updateSelectedCellsOverride({ textAlign: v as 'left' | 'center' | 'right' | 'justify' }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {multiAlign.mixed && <SelectItem value="__mixed__">— mixed —</SelectItem>}
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
                <SelectItem value="justify">Justify</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="V-Align">
            <Select
              value={multiVAlign.mixed ? '__mixed__' : multiVAlign.value}
              onValueChange={(v) => { if (v !== '__mixed__') updateSelectedCellsOverride({ verticalAlign: v as 'top' | 'middle' | 'bottom' }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {multiVAlign.mixed && <SelectItem value="__mixed__">— mixed —</SelectItem>}
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="middle">Middle</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Padding">
            <NumericField
              value={[multiPadding.mixed ? props.cellPadding : multiPadding.value]}
              min={0}
              max={20}
              step={1}
              onValueChange={([v]) => updateSelectedCellsOverride({ padding: v })}
              className="flex-1"
            />
          </PropertyField>
          <PropertyField label="BG Color">
            <div className="flex items-center gap-1.5">
              {multiBgColor.mixed && <span className="text-[9px] text-muted-foreground italic">mixed</span>}
              <ColorInput
                value={multiBgColor.value}
                onChange={(v) => updateSelectedCellsOverride({ bgColor: v })}
              />
            </div>
          </PropertyField>
          <PropertyField label="Text Color">
            <div className="flex items-center gap-1.5">
              {multiTextColor.mixed && <span className="text-[9px] text-muted-foreground italic">mixed</span>}
              <ColorInput
                value={multiTextColor.value}
                onChange={(v) => updateSelectedCellsOverride({ color: v })}
              />
            </div>
          </PropertyField>
          <PropertyField label="Font Weight">
            <Select
              value={multiFontWeight.mixed ? '__mixed__' : multiFontWeight.value}
              onValueChange={(v) => { if (v !== '__mixed__') updateSelectedCellsOverride({ fontWeight: v }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {multiFontWeight.mixed && <SelectItem value="__mixed__">— mixed —</SelectItem>}
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="bold">Bold</SelectItem>
                <SelectItem value="lighter">Lighter</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="600">600</SelectItem>
                <SelectItem value="700">700</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Font Family">
            <Select
              value={multiFontFamily.mixed ? '__mixed__' : multiFontFamily.value}
              onValueChange={(v) => { if (v !== '__mixed__') updateSelectedCellsOverride({ fontFamily: v }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {multiFontFamily.mixed && <SelectItem value="__mixed__">— mixed —</SelectItem>}
                {FONT_FAMILIES_GROUPED.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">{group.label}</SelectLabel>
                    {group.options.map((f) => (
                      <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Font Size">
            <SliderField
              value={[multiFontSize.mixed ? props.fontSize : multiFontSize.value]}
              min={6}
              max={100}
              step={1}
              unit="px"
              colorTheme="purple"
              onValueChange={([v]) => updateSelectedCellsOverride({ fontSize: v })}
              className="flex-1"
            />
          </PropertyField>
          <PropertyField label="Text Transform">
            <Select
              value={multiTextTransform.mixed ? '__mixed__' : multiTextTransform.value}
              onValueChange={(v) => { if (v !== '__mixed__') updateSelectedCellsOverride({ textTransform: v as 'none' | 'uppercase' | 'lowercase' | 'capitalize' }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {multiTextTransform.mixed && <SelectItem value="__mixed__">— mixed —</SelectItem>}
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                <SelectItem value="lowercase">lowercase</SelectItem>
                <SelectItem value="capitalize">Capitalize</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>

          {/* Justify columns/rows — equally space selected columns and rows */}
          {selectedCells.size > 0 && (() => {
            const selectedCols = new Set<number>();
            const selectedRows = new Set<number>();
            for (const key of selectedCells) {
              const { r, c } = parseCellKey(key);
              selectedCols.add(c);
              selectedRows.add(r);
            }
            const hasMultipleCols = selectedCols.size >= 2;
            const hasMultipleRows = selectedRows.size >= 2;

            const justifyColumns = () => {
              const cw = ensureColWidths(props.cols, props.colWidths);
              const cols = [...selectedCols].sort((a, b) => a - b);
              const totalWidth = cols.reduce((sum, c) => sum + (cw[c] || 1), 0);
              const equalWidth = totalWidth / cols.length;
              const newColWidths = [...cw];
              for (const c of cols) {
                newColWidths[c] = equalWidth;
              }
              update({ colWidths: newColWidths });
            };

            const justifyRows = () => {
              const rh = ensureRowHeights(props.rows, props.rowHeights);
              const rows = [...selectedRows].sort((a, b) => a - b);
              const totalHeight = rows.reduce((sum, r) => sum + (rh[r] || 1), 0);
              const equalHeight = totalHeight / rows.length;
              const newRowHeights = [...rh];
              for (const r of rows) {
                newRowHeights[r] = equalHeight;
              }
              update({ rowHeights: newRowHeights });
            };

            if (!hasMultipleCols && !hasMultipleRows) return null;

            return (
              <div className="flex gap-1.5">
                {hasMultipleCols && (
                  <button
                    data-no-drag
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded border border-border hover:bg-accent transition-colors"
                    onClick={justifyColumns}
                    title="Equalize selected column widths"
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    Justify Cols
                  </button>
                )}
                {hasMultipleRows && (
                  <button
                    data-no-drag
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded border border-border hover:bg-accent transition-colors"
                    onClick={justifyRows}
                    title="Equalize selected row heights"
                  >
                    <Rows3 className="w-3.5 h-3.5" />
                    Justify Rows
                  </button>
                )}
              </div>
            );
          })()}

          {/* Per-side cell border toggles — single cell only for simplicity */}
          {selectedCells.size === 1 && (() => {
            const { r, c } = parseCellKey([...selectedCells][0]);
            const selOverride = getCellOverride(r, c);
            return (
              <>
                <PropertyField label="Cell Borders">
                  <div className="flex items-center justify-center">
                    <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-fit">
                      <div />
                      <Button
                        variant={selOverride.borderTop !== false ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleCellBorderLinked(r, c, 'borderTop')}
                        title="Top cell border"
                      >
                        <PanelTop className="h-3.5 w-3.5" />
                      </Button>
                      <div />
                      <Button
                        variant={selOverride.borderLeft !== false ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleCellBorderLinked(r, c, 'borderLeft')}
                        title="Left cell border"
                      >
                        <PanelLeft className="h-3.5 w-3.5" />
                      </Button>
                      <div className="h-7 w-7 flex items-center justify-center">
                        <Square className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <Button
                        variant={selOverride.borderRight !== false ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleCellBorderLinked(r, c, 'borderRight')}
                        title="Right cell border"
                      >
                        <PanelRight className="h-3.5 w-3.5" />
                      </Button>
                      <div />
                      <Button
                        variant={selOverride.borderBottom !== false ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleCellBorderLinked(r, c, 'borderBottom')}
                        title="Bottom cell border"
                      >
                        <PanelBottom className="h-3.5 w-3.5" />
                      </Button>
                      <div />
                    </div>
                  </div>
                </PropertyField>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[9px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${selOverride.borderTop !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Top
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${selOverride.borderRight !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Right
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${selOverride.borderBottom !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Bottom
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${selOverride.borderLeft !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Left
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
      </AccordionSection>

      {/* ===== CELL EDITOR — VISUAL MINI-TABLE ===== */}
      <AccordionSection label="Corner Radius" keywords="corner radius rounded border radius tl tr bl br">
      <div className="space-y-2">
        {/* Linked / Individual toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {props.cornerRadius.mode === 'linked' ? 'All Corners' : 'Individual Corners'}
          </Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-1"
            onClick={() => {
              if (props.cornerRadius.mode === 'linked') {
                // Switch to individual: split current "all" into each corner
                update({
                  cornerRadius: {
                    ...props.cornerRadius,
                    mode: 'individual',
                    topLeft: props.cornerRadius.all,
                    topRight: props.cornerRadius.all,
                    bottomRight: props.cornerRadius.all,
                    bottomLeft: props.cornerRadius.all,
                  },
                });
              } else {
                // Switch to linked: average the 4 corners and sync
                const avg = Math.round((props.cornerRadius.topLeft + props.cornerRadius.topRight + props.cornerRadius.bottomRight + props.cornerRadius.bottomLeft) / 4);
                update({
                  cornerRadius: {
                    ...props.cornerRadius,
                    mode: 'linked',
                    all: avg,
                    topLeft: avg,
                    topRight: avg,
                    bottomRight: avg,
                    bottomLeft: avg,
                  },
                });
              }
            }}
            title={props.cornerRadius.mode === 'linked' ? 'Customize corners individually' : 'Link all corners'}
          >
            {props.cornerRadius.mode === 'linked' ? (
              <>
                <Link className="h-3 w-3" />
                Linked
              </>
            ) : (
              <>
                <Link2Off className="h-3 w-3" />
                Individual
              </>
            )}
          </Button>
        </div>

        {props.cornerRadius.mode === 'linked' ? (
          <SliderField
            value={[props.cornerRadius.all]}
            min={0}
            max={100}
            step={1}
            unit="px"
            colorTheme="blue"
            onValueChange={([v]) => update({
              cornerRadius: { ...props.cornerRadius, all: v, topLeft: v, topRight: v, bottomRight: v, bottomLeft: v },
            })}
            className="flex-1"
          />
        ) : (
          /* Individual corner inputs with visual diagram */
          <div className="space-y-2">
            {/* Visual corner diagram */}
            <div className="flex justify-center">
              <div className="relative w-28 h-20 border border-border rounded-md bg-muted/30">
                {/* Corner labels positioned at each corner */}
                <button
                  className={`absolute top-1 left-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                    props.cornerRadius.topLeft > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  title="Top-Left"
                >
                  {props.cornerRadius.topLeft || '0'}
                </button>
                <button
                  className={`absolute top-1 right-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                    props.cornerRadius.topRight > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  title="Top-Right"
                >
                  {props.cornerRadius.topRight || '0'}
                </button>
                <button
                  className={`absolute bottom-1 right-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                    props.cornerRadius.bottomRight > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  title="Bottom-Right"
                >
                  {props.cornerRadius.bottomRight || '0'}
                </button>
                <button
                  className={`absolute bottom-1 left-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                    props.cornerRadius.bottomLeft > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  title="Bottom-Left"
                >
                  {props.cornerRadius.bottomLeft || '0'}
                </button>
              </div>
            </div>

            {/* Individual inputs in a 2x2 grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-muted-foreground w-6 shrink-0">TL</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={props.cornerRadius.topLeft}
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                    update({ cornerRadius: { ...props.cornerRadius, topLeft: v } });
                  }}
                  className="h-6 text-xs flex-1"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-muted-foreground w-6 shrink-0">TR</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={props.cornerRadius.topRight}
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                    update({ cornerRadius: { ...props.cornerRadius, topRight: v } });
                  }}
                  className="h-6 text-xs flex-1"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-muted-foreground w-6 shrink-0">BL</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={props.cornerRadius.bottomLeft}
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                    update({ cornerRadius: { ...props.cornerRadius, bottomLeft: v } });
                  }}
                  className="h-6 text-xs flex-1"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-muted-foreground w-6 shrink-0">BR</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={props.cornerRadius.bottomRight}
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                    update({ cornerRadius: { ...props.cornerRadius, bottomRight: v } });
                  }}
                  className="h-6 text-xs flex-1"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      </AccordionSection>

      {/* ===== DEFAULT CELL STYLING ===== */}
      <AccordionSection label="Header Row" keywords="header background text font weight">
        <PropertyField label="Show Header">
        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={props.showHeader}
              onChange={(e) => update({ showHeader: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform peer-checked:after:translate-x-4" />
          </label>
          <span className="text-xs text-muted-foreground">{props.showHeader ? 'Visible' : 'Hidden'}</span>
        </div>
      </PropertyField>
      {props.showHeader && (
        <>
          <PropertyField label="Header BG">
            <ColorInput value={props.headerBg} onChange={(v) => update({ headerBg: v })} />
          </PropertyField>
          <PropertyField label="Header Text Color">
            <ColorInput value={props.headerColor} onChange={(v) => update({ headerColor: v })} />
          </PropertyField>
          <PropertyField label="Header Font Weight">
            <Select value={props.headerFontWeight} onValueChange={(v) => update({ headerFontWeight: v })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="bold">Bold</SelectItem>
                <SelectItem value="lighter">Lighter</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="600">600</SelectItem>
                <SelectItem value="700">700</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
        </>
      )}
      </AccordionSection>

      {/* ===== TABLE BORDER ===== */}
      <AccordionSection label="Reorder Column" defaultOpen={false}>
        <DraggableReorderList
          items={Array.from({ length: props.cols }, (_, i) => ({
            id: `col-${i}`,
            label: (props.colNames ?? Array.from({ length: props.cols }, (_, j) => `Column ${j + 1}`))[i],
            color: props.colBgColors[i] || undefined,
          }))}
          onReorder={handleColReorder}
        />
      </AccordionSection>

      {/* ===== HEADER ===== */}
      <AccordionSection label="Reorder Row" defaultOpen={false}>
        <DraggableReorderList
          items={props.cellData.map((_, i) => ({
            id: `row-${i}`,
            label: (props.rowNames ?? Array.from({ length: props.cellData.length }, (_, j) => `Row ${j + 1}`))[i],
            color: props.rowBgColors[i] || undefined,
          }))}
          onReorder={handleRowReorder}
        />
      </AccordionSection>

      {/* Reorder Column */}
      <AccordionSection label="Remove Column" defaultOpen={false}>
        <div className="flex gap-1">
          <Select value={String(removeColIdx)} onValueChange={(v) => setRemoveColIdx(+v)}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: props.cols }, (_, i) => (
                <SelectItem key={i} value={String(i)}>{(props.colNames ?? Array.from({ length: props.cols }, (_, j) => `Column ${j + 1}`))[i]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0"
            onClick={() => removeColumn(removeColIdx)}
            disabled={props.cols <= 1}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        </div>
      </AccordionSection>

      {/* Reorder Row */}
      <AccordionSection label="Remove Row" defaultOpen={false}>
        <div className="flex gap-1">
          <Select value={String(removeRowIdx)} onValueChange={(v) => setRemoveRowIdx(+v)}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.cellData.map((_, i) => (
                <SelectItem key={i} value={String(i)}>
                  {(props.rowNames ?? Array.from({ length: props.cellData.length }, (_, j) => `Row ${j + 1}`))[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0"
            onClick={() => removeRow(removeRowIdx)}
            disabled={props.rows <= 1}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        </div>
      </AccordionSection>

      {/* ===== COLUMN COLORS ===== */}
      <AccordionSection label="Structure" keywords="rows columns add remove row col">
        <PropertyPair
          label1="Rows"
          child1={
            <Input
              type="number"
              min={1}
              max={50}
              value={props.rows}
              onChange={(e) => {
                const newRows = Math.max(1, +e.target.value);
                const newCellData: string[][] = [];
                for (let r = 0; r < newRows; r++) {
                  newCellData[r] = [];
                  for (let c = 0; c < props.cols; c++) {
                    newCellData[r][c] = props.cellData[r]?.[c] || '';
                  }
                }
                // Keep rowHeights / rowNames aligned with the new row count.
                const oldRowHeights = props.rowHeights ?? Array(props.rows).fill(1);
                const newRowHeights = Array.from({ length: newRows }, (_, i) => oldRowHeights[i] ?? 1);
                const oldRowNames = props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`);
                const newRowNames = Array.from({ length: newRows }, (_, i) => oldRowNames[i] ?? `Row ${i + 1}`);
                update({ rows: newRows, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
              }}
              className="h-7 text-xs"
            />
          }
          label2="Columns"
          child2={
            <Input
              type="number"
              min={1}
              max={20}
              value={props.cols}
              onChange={(e) => {
                const newCols = Math.max(1, +e.target.value);
                const newCellData = props.cellData.map((row) => {
                  const newRow: string[] = [];
                  for (let c = 0; c < newCols; c++) {
                    newRow[c] = row[c] || '';
                  }
                  return newRow;
                });
                // Keep colWidths / colNames aligned with the new col count.
                const oldColWidths = props.colWidths ?? Array(props.cols).fill(1);
                const newColWidths = Array.from({ length: newCols }, (_, i) => oldColWidths[i] ?? 1);
                const oldColNames = props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`);
                const newColNames = Array.from({ length: newCols }, (_, i) => oldColNames[i] ?? `Column ${i + 1}`);
                update({ cols: newCols, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
              }}
              className="h-7 text-xs"
            />
          }
        />
        <div className="flex gap-1 mt-1">
          <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={addRow}>
            <Plus className="h-3 w-3" /> Row
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={addColumn}>
            <Plus className="h-3 w-3" /> Col
          </Button>
        </div>
      </AccordionSection>

      {/* Remove Row */}
      <AccordionSection label="Table Border" keywords="width style color outer inner side toggle">
      <PropertyField label="Width">
        <SliderField
          value={[props.borderWidth]}
          min={0}
          max={5}
          step={1}
          unit="px"
          colorTheme="orange"
          onValueChange={([v]) => update({ borderWidth: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Style">
        <Select value={props.borderStyle} onValueChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>

      {/* Per-side outer border toggles in a compass-like grid */}
      <PropertyField label="Outer Borders">
        <div className="flex items-center justify-center">
          <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-fit">
            {/* Row 0: empty, Top, empty */}
            <div />
            <Button
              variant={props.showBorderTop ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ showBorderTop: !props.showBorderTop })}
              title="Top border"
            >
              <PanelTop className="h-3.5 w-3.5" />
            </Button>
            <div />
            {/* Row 1: Left, Inner, Right */}
            <Button
              variant={props.showBorderLeft ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ showBorderLeft: !props.showBorderLeft })}
              title="Left border"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={props.showInnerBorders ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ showInnerBorders: !props.showInnerBorders })}
              title="Inner borders"
            >
              <Grid3x3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={props.showBorderRight ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ showBorderRight: !props.showBorderRight })}
              title="Right border"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
            {/* Row 2: empty, Bottom, empty */}
            <div />
            <Button
              variant={props.showBorderBottom ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ showBorderBottom: !props.showBorderBottom })}
              title="Bottom border"
            >
              <PanelBottom className="h-3.5 w-3.5" />
            </Button>
            <div />
          </div>
        </div>
      </PropertyField>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[9px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.showBorderTop ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
          Top
        </div>
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.showBorderRight ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
          Right
        </div>
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.showBorderBottom ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
          Bottom
        </div>
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.showBorderLeft ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
          Left
        </div>
        <div className="flex items-center gap-1 col-span-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.showInnerBorders ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
          Inner Borders
        </div>
      </div>
      </AccordionSection>

      {/* ===== CORNER RADIUS ===== */}
    </>
  );
}

// Image Properties
function ImagePropertiesPanel({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'image'; data: ImageProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((updates: Partial<ImageProperties>) => {
    updateElementProperties(element.id, {
      type: 'image',
      data: { ...props, ...updates },
    });
  }, [element.id, props, updateElementProperties]);

  const effects: RectangleEffects = useMemo(() => props.effects ?? { ...DEFAULT_EFFECTS }, [props.effects]);

  const updateEffects = (effectUpdates: Partial<RectangleEffects>) => {
    update({ effects: { ...effects, ...effectUpdates } } as Partial<ImageProperties>);
  };

  const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
    updateEffects({ shadow: { ...effects.shadow, ...shadowUpdates } });
  };

  const updateReflection = (reflectionUpdates: Partial<ReflectionEffect>) => {
    updateEffects({ reflection: { ...effects.reflection, ...reflectionUpdates } });
  };

  const updateGlow = (glowUpdates: Partial<GlowEffect>) => {
    updateEffects({ glow: { ...effects.glow, ...glowUpdates } });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        update({ src: ev.target?.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <>
      <AccordionSection label="Adjustments" keywords="brightness contrast saturation blur filter" defaultOpen={false}>
      <PropertyField label="Brightness">
        <NumericField
          value={[props.brightness ?? 100]}
          min={0}
          max={200}
          step={1}
          onValueChange={([v]) => update({ brightness: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Contrast">
        <NumericField
          value={[props.contrast ?? 100]}
          min={0}
          max={200}
          step={1}
          onValueChange={([v]) => update({ contrast: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Saturation">
        <NumericField
          value={[props.saturation ?? 100]}
          min={0}
          max={200}
          step={1}
          onValueChange={([v]) => update({ saturation: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Blur">
        <NumericField
          value={[props.blur ?? 0]}
          min={0}
          max={20}
          step={0.5}
          onValueChange={([v]) => update({ blur: v })}
          className="flex-1"
        />
      </PropertyField>
      </AccordionSection>

      {/* ===== SHADOW ===== */}
      <AccordionSection label="Appearance" keywords="opacity visibility">
      <PropertyField label="Radius">
        <SliderField
          value={[props.borderRadius]}
          min={0}
          max={50}
          step={1}
          unit="px"
          colorTheme="blue"
          onValueChange={([v]) => update({ borderRadius: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Opacity">
        <SliderField
          value={[props.opacity * 100]}
          min={0}
          max={100}
          step={1}
          unit="%"
          colorTheme="gray"
          onValueChange={([v]) => update({ opacity: v / 100 })}
          className="flex-1"
        />
      </PropertyField>
      </AccordionSection>

      {/* ===== ADJUSTMENTS ===== */}
      <AccordionSection label="Border" keywords="width color style dashed dotted">
      <PropertyField label="Width">
        <SliderField
          value={[props.borderWidth]}
          min={0}
          max={10}
          step={1}
          unit="px"
          colorTheme="orange"
          onValueChange={([v]) => update({ borderWidth: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>
      </AccordionSection>

      <AccordionSection label="Fitting" keywords="object fit contain cover fill">
      <PropertyField label="Object Fit">
        <Select value={props.objectFit} onValueChange={(v) => update({ objectFit: v as 'contain' | 'cover' | 'fill' })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contain">Contain</SelectItem>
            <SelectItem value="cover">Cover</SelectItem>
            <SelectItem value="fill">Fill</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>
      </AccordionSection>

      <AccordionSection label="Glow" keywords="glow color size" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Glow</Label>
        <Switch
          checked={effects.glow.enabled}
          onCheckedChange={(v) => updateGlow({ enabled: v })}
        />
      </div>
      {effects.glow.enabled && (
        <div className="space-y-2">
          <PropertyField label="Color">
            <ColorInput value={effects.glow.color} onChange={(v) => updateGlow({ color: v })} />
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.glow.size]} min={1} max={50} step={1} onValueChange={([v]) => updateGlow({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.glow.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateGlow({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>

      {/* ===== REFLECTION ===== */}
      <AccordionSection label="Image Source" keywords="upload image file src url">
      {props.src ? (
        <div className="space-y-2">
          <div className="border border-border rounded-md overflow-hidden h-24 flex items-center justify-center bg-muted/30">
            <img src={props.src} alt="Preview" className="max-h-full max-w-full object-contain" />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            Change Image
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Image
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
      </AccordionSection>

      <AccordionSection label="Reflection" keywords="reflection mirror soft tight fade size distance" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Reflection</Label>
        <Switch
          checked={effects.reflection.enabled}
          onCheckedChange={(v) => updateReflection({ enabled: v })}
        />
      </div>
      {effects.reflection.enabled && (
        <div className="space-y-2">
          <PropertyField label="Preset">
            <Select value={effects.reflection.preset} onValueChange={(v) => updateReflection({ preset: v as ReflectionEffect['preset'] })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soft">Soft</SelectItem>
                <SelectItem value="tight">Tight</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="mirror">Mirror</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.reflection.size]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.reflection.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Distance">
            <NumericField value={[effects.reflection.distance]} min={0} max={50} step={1} onValueChange={([v]) => updateReflection({ distance: v })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>
      <AccordionSection label="Shadow" keywords="outer inner drop blur distance angle color">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Shadow</Label>
        <Switch
          checked={effects.shadow.enabled}
          onCheckedChange={(v) => updateShadow({ enabled: v })}
        />
      </div>
      {effects.shadow.enabled && (
        <div className="space-y-2">
          <PropertyField label="Type">
            <Select value={effects.shadow.type} onValueChange={(v) => updateShadow({ type: v as ShadowEffect['type'] })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outer">Outer</SelectItem>
                <SelectItem value="inner">Inner</SelectItem>
                <SelectItem value="drop">Drop</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Color">
            <ColorInput value={effects.shadow.color} onChange={(v) => updateShadow({ color: v })} />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.shadow.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateShadow({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Blur">
            <NumericField value={[effects.shadow.blur]} min={0} max={50} step={1} onValueChange={([v]) => updateShadow({ blur: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Distance">
            <NumericField value={[effects.shadow.distance]} min={0} max={50} step={1} onValueChange={([v]) => updateShadow({ distance: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Angle">
            <NumericField value={[effects.shadow.angle]} min={0} max={360} step={1} onValueChange={([v]) => updateShadow({ angle: v })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>

      {/* ===== GLOW ===== */}
    </>
  );
}

// Line Properties
function LinePropertiesPanel({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'line'; data: LineProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const updateElement = useDesignerStore((s) => s.updateElement);

  const update = useCallback((updates: Partial<LineProperties>) => {
    updateElementProperties(element.id, {
      type: 'line',
      data: { ...props, ...updates },
    });
  }, [element.id, props, updateElementProperties]);

  // Update an endpoint and recalculate bounding box
  const updateEndpoint = (endpoint: 'start' | 'end', axis: 'x' | 'y', value: number) => {
    const startX = element.lineStartX ?? element.x;
    const startY = element.lineStartY ?? element.y;
    const endX = element.lineEndX ?? (element.x + element.width);
    const endY = element.lineEndY ?? element.y;

    let newStartX = startX;
    let newStartY = startY;
    let newEndX = endX;
    let newEndY = endY;

    if (endpoint === 'start') {
      if (axis === 'x') newStartX = value;
      else newStartY = value;
    } else {
      if (axis === 'x') newEndX = value;
      else newEndY = value;
    }

    const bounds = computeLineBounds(newStartX, newStartY, newEndX, newEndY);
    updateElement(element.id, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      lineStartX: newStartX,
      lineStartY: newStartY,
      lineEndX: newEndX,
      lineEndY: newEndY,
    });
  };

  const startX = element.lineStartX ?? element.x;
  const startY = element.lineStartY ?? element.y;
  const endX = element.lineEndX ?? (element.x + element.width);
  const endY = element.lineEndY ?? element.y;

  return (
    <>
      <AccordionSection label="Appearance" keywords="opacity visibility">
        <PropertyField label="Opacity">
          <SliderField
            value={[props.opacity * 100]}
            min={0}
            max={100}
            step={1}
            unit="%"
            colorTheme="gray"
            onValueChange={([v]) => update({ opacity: v / 100 })}
            className="flex-1"
          />
        </PropertyField>
      </AccordionSection>
      <AccordionSection label="End Point" keywords="end x y coordinates finish">
        <PropertyPair
          label1="X"
          child1={
            <Input
              type="number"
              value={Math.round(endX)}
              onChange={(e) => updateEndpoint('end', 'x', +e.target.value)}
              className="h-7 text-xs"
            />
          }
          label2="Y"
          child2={
            <Input
              type="number"
              value={Math.round(endY)}
              onChange={(e) => updateEndpoint('end', 'y', +e.target.value)}
              className="h-7 text-xs"
            />
          }
        />
      </AccordionSection>

      <AccordionSection label="Start Point" keywords="start x y coordinates begin">
        <PropertyPair
          label1="X"
          child1={
            <Input
              type="number"
              value={Math.round(startX)}
              onChange={(e) => updateEndpoint('start', 'x', +e.target.value)}
              className="h-7 text-xs"
            />
          }
          label2="Y"
          child2={
            <Input
              type="number"
              value={Math.round(startY)}
              onChange={(e) => updateEndpoint('start', 'y', +e.target.value)}
              className="h-7 text-xs"
            />
          }
        />
      </AccordionSection>

      <AccordionSection label="Stroke" keywords="width color style dashed dotted cap line">
        <PropertyField label="Width">
          <SliderField
            value={[props.strokeWidth]}
            min={1}
            max={20}
            step={1}
            unit="px"
            colorTheme="red"
            onValueChange={([v]) => update({ strokeWidth: v })}
            className="flex-1"
          />
        </PropertyField>
        <PropertyField label="Color">
          <ColorInput value={props.strokeColor} onChange={(v) => update({ strokeColor: v })} />
        </PropertyField>
        <PropertyField label="Style">
          <Select value={props.strokeStyle} onValueChange={(v) => update({ strokeStyle: v as 'solid' | 'dashed' | 'dotted' })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="solid">Solid</SelectItem>
              <SelectItem value="dashed">Dashed</SelectItem>
              <SelectItem value="dotted">Dotted</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
        <PropertyField label="Cap">
          <Select value={props.lineCap} onValueChange={(v) => update({ lineCap: v as 'butt' | 'round' | 'square' })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="butt">Butt</SelectItem>
              <SelectItem value="round">Round</SelectItem>
              <SelectItem value="square">Square</SelectItem>
            </SelectContent>
          </Select>
        </PropertyField>
      </AccordionSection>

    </>
  );
}

// Rectangle Properties
function RectanglePropertiesPanel({ element, effectsOnly }: { element: CanvasElement; effectsOnly?: boolean }) {
  const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const resetRectCorners = useDesignerStore((s) => s.resetRectCorners);
  const setRectRotation = useDesignerStore((s) => s.setRectRotation);
  const isDeformed = hasCustomCorners(element);

  // Provide safe defaults for effects (backward compat)
  const effects: RectangleEffects = useMemo(() => rawProps.effects ?? { ...DEFAULT_EFFECTS }, [rawProps.effects]);
  const props: RectangleProperties = useMemo(() => ({ ...rawProps, effects }), [rawProps, effects]);

  const update = useCallback((updates: Partial<RectangleProperties>) => {
    updateElementProperties(element.id, {
      type: 'rectangle',
      data: { ...props, ...updates },
    });
  }, [element.id, props, updateElementProperties]);

  const updateEffects = (effectUpdates: Partial<RectangleEffects>) => {
    update({ effects: { ...effects, ...effectUpdates } });
  };

  const updateGradient = (gradientUpdates: Partial<GradientFill>) => {
    updateEffects({ gradient: { ...effects.gradient, ...gradientUpdates } });
  };

  const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
    updateEffects({ shadow: { ...effects.shadow, ...shadowUpdates } });
  };

  const updateReflection = (reflectionUpdates: Partial<ReflectionEffect>) => {
    updateEffects({ reflection: { ...effects.reflection, ...reflectionUpdates } });
  };

  const updateGlow = (glowUpdates: Partial<GlowEffect>) => {
    updateEffects({ glow: { ...effects.glow, ...glowUpdates } });
  };

  const updateGradientStop = (index: number, updates: Partial<GradientStop>) => {
    const newStops = [...effects.gradient.stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateGradient({ stops: newStops });
  };

  const addGradientStop = () => {
    const stops = effects.gradient.stops;
    // Find the largest gap between stops and add in the middle
    if (stops.length < 2) {
      updateGradient({ stops: [...stops, { color: '#888888', position: 50, opacity: 1 }] });
      return;
    }
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    let maxGap = 0;
    let gapIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].position - sorted[i].position;
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const newPos = Math.round((sorted[gapIdx].position + sorted[gapIdx + 1].position) / 2);
    // Mix colors
    const c1 = sorted[gapIdx].color;
    const c2 = sorted[gapIdx + 1].color;
    const mix = (a: number, b: number) => Math.round((a + b) / 2);
    const r = mix(parseInt(c1.slice(1, 3), 16), parseInt(c2.slice(1, 3), 16));
    const g = mix(parseInt(c1.slice(3, 5), 16), parseInt(c2.slice(3, 5), 16));
    const b = mix(parseInt(c1.slice(5, 7), 16), parseInt(c2.slice(5, 7), 16));
    const mixColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    updateGradient({ stops: [...stops, { color: mixColor, position: newPos, opacity: 1 }] });
  };

  const removeGradientStop = (index: number) => {
    if (effects.gradient.stops.length <= 2) return; // minimum 2 stops
    const newStops = effects.gradient.stops.filter((_, i) => i !== index);
    updateGradient({ stops: newStops });
  };

  return (
    <>
      {!effectsOnly && (<>
      {/* ===== Custom Corner Shape reset (only shown when deformed) ===== */}
      {isDeformed && (
        <div className="px-3 py-2 mb-1 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-purple-700 dark:text-purple-300 leading-tight">
              <div className="font-medium">Custom corner shape</div>
              <div className="opacity-80">Alt+drag a corner to deform · Alt+Shift to constrain</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs shrink-0 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50"
              onClick={() => resetRectCorners(element.id)}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          </div>
        </div>
      )}
      {/* ===== FILL ===== */}
      <AccordionSection label="Border" keywords="width color style dashed dotted">
      <PropertyField label="Width">
        <SliderField
          value={[props.borderWidth]}
          min={0}
          max={10}
          step={1}
          unit="px"
          colorTheme="orange"
          onValueChange={([v]) => update({ borderWidth: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>
      <PropertyField label="Style">
        <Select value={props.borderStyle} onValueChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>
      </AccordionSection>

      {/* ===== APPEARANCE ===== */}
      <AccordionSection label="Corner Radius" keywords="corner radius rounded border radius tl tr bl br">
      {(() => {
        const cr = normalizeRectBorderRadius(props.borderRadius);
        return (
          <div className="space-y-2">
            {/* Linked / Individual toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {cr.mode === 'linked' ? 'All Corners' : 'Individual Corners'}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => {
                  if (cr.mode === 'linked') {
                    update({
                      borderRadius: {
                        ...cr,
                        mode: 'individual',
                        topLeft: cr.all,
                        topRight: cr.all,
                        bottomRight: cr.all,
                        bottomLeft: cr.all,
                      },
                    });
                  } else {
                    const avg = Math.round((cr.topLeft + cr.topRight + cr.bottomRight + cr.bottomLeft) / 4);
                    update({
                      borderRadius: {
                        ...cr,
                        mode: 'linked',
                        all: avg,
                        topLeft: avg,
                        topRight: avg,
                        bottomRight: avg,
                        bottomLeft: avg,
                      },
                    });
                  }
                }}
                title={cr.mode === 'linked' ? 'Customize corners individually' : 'Link all corners'}
              >
                {cr.mode === 'linked' ? (
                  <>
                    <Link className="h-3 w-3" />
                    Linked
                  </>
                ) : (
                  <>
                    <Link2Off className="h-3 w-3" />
                    Individual
                  </>
                )}
              </Button>
            </div>

            {cr.mode === 'linked' ? (
              <SliderField
                value={[cr.all]}
                min={0}
                max={100}
                step={1}
                unit="px"
                colorTheme="blue"
                onValueChange={([v]) => update({
                  borderRadius: { ...cr, all: v, topLeft: v, topRight: v, bottomRight: v, bottomLeft: v },
                })}
                className="flex-1"
              />
            ) : (
              /* Individual corner inputs with visual diagram */
              <div className="space-y-2">
                {/* Visual corner diagram */}
                <div className="flex justify-center">
                  <div className="relative w-28 h-20 border border-border rounded-md bg-muted/30">
                    <button
                      className={`absolute top-1 left-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                        cr.topLeft > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                      title="Top-Left"
                    >
                      {cr.topLeft || '0'}
                    </button>
                    <button
                      className={`absolute top-1 right-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                        cr.topRight > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                      title="Top-Right"
                    >
                      {cr.topRight || '0'}
                    </button>
                    <button
                      className={`absolute bottom-1 right-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                        cr.bottomRight > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                      title="Bottom-Right"
                    >
                      {cr.bottomRight || '0'}
                    </button>
                    <button
                      className={`absolute bottom-1 left-1 w-6 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                        cr.bottomLeft > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                      title="Bottom-Left"
                    >
                      {cr.bottomLeft || '0'}
                    </button>
                  </div>
                </div>

                {/* Individual inputs in a 2x2 grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] text-muted-foreground w-6 shrink-0">TL</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={cr.topLeft}
                      onChange={(e) => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        update({ borderRadius: { ...cr, topLeft: v } });
                      }}
                      className="h-6 text-xs flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] text-muted-foreground w-6 shrink-0">TR</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={cr.topRight}
                      onChange={(e) => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        update({ borderRadius: { ...cr, topRight: v } });
                      }}
                      className="h-6 text-xs flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] text-muted-foreground w-6 shrink-0">BL</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={cr.bottomLeft}
                      onChange={(e) => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        update({ borderRadius: { ...cr, bottomLeft: v } });
                      }}
                      className="h-6 text-xs flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] text-muted-foreground w-6 shrink-0">BR</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={cr.bottomRight}
                      onChange={(e) => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        update({ borderRadius: { ...cr, bottomRight: v } });
                      }}
                      className="h-6 text-xs flex-1"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
      <PropertyField label="Opacity">
        <SliderField
          value={[props.opacity * 100]}
          min={0}
          max={100}
          step={1}
          unit="%"
          colorTheme="gray"
          onValueChange={([v]) => update({ opacity: v / 100 })}
          className="flex-1"
        />
      </PropertyField>
      </AccordionSection>
      {/* ===== TRANSFORM (rotation) ===== */}
      {/* Only rectangles support rotation (per spec). The slider covers the full
          [-180, 180] range at 1° resolution; the numeric input lets the user
          type an exact value. The reset button restores 0°. The store's
          setRectRotation action normalizes the angle to [-180, 180] before
          writing, so the displayed value stays bounded even if the user types
          something like 540°. */}
      <AccordionSection label="Transform" keywords="rotation rotate angle spin turn degrees">
      <PropertyField label="Rotation">
        <div className="flex items-center gap-2 w-full">
          <SliderField
            // Slider range is [-180, 180] — one full revolution in either
            // direction. Step 1° for fine control; users can hold Shift while
            // dragging the canvas rotation handle for 15° snap.
            value={[getRectRotation(element)]}
            min={-180}
            max={180}
            step={1}
            unit="°"
            colorTheme="purple"
            onValueChange={([v]) => setRectRotation(element.id, v)}
            className="flex-1"
          />
          <NumericField
            // Numeric input — accepts any value; setRectRotation normalizes
            // to [-180, 180] so typing 270 stores -90, typing 540 stores 180, etc.
            value={[getRectRotation(element)]}
            min={-180}
            max={180}
            step={1}
            onValueChange={([v]) => setRectRotation(element.id, v)}
            className="w-16"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            title="Reset rotation to 0°"
            onClick={() => setRectRotation(element.id, 0)}
            disabled={getRectRotation(element) === 0}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Fill" keywords="solid gradient color stop linear radial direction picture image transparent">
      <GradientStopBar
        gradient={effects.gradient}
        onGradientChange={(updates) => updateGradient(updates)}
      />
      {effects.gradient.type === 'solid' && (
        <PropertyField label="Fill Color">
          <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} />
        </PropertyField>
      )}
      </AccordionSection>
      </>)}

      {/* ===== GLOW ===== */}
      <AccordionSection label="Glow" keywords="glow color size" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Glow</Label>
        <Switch
          checked={effects.glow.enabled}
          onCheckedChange={(v) => updateGlow({ enabled: v })}
        />
      </div>
      {effects.glow.enabled && (
        <div className="space-y-2">
          <PropertyField label="Color">
            <ColorInput value={effects.glow.color} onChange={(v) => updateGlow({ color: v })} />
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.glow.size]} min={1} max={50} step={1} onValueChange={([v]) => updateGlow({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.glow.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateGlow({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>

      {/* ===== REFLECTION ===== */}
      <AccordionSection label="Reflection" keywords="reflection mirror soft tight fade size distance" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Reflection</Label>
        <Switch
          checked={effects.reflection.enabled}
          onCheckedChange={(v) => updateReflection({ enabled: v })}
        />
      </div>
      {effects.reflection.enabled && (
        <div className="space-y-2">
          <PropertyField label="Preset">
            <Select value={effects.reflection.preset} onValueChange={(v) => updateReflection({ preset: v as ReflectionEffect['preset'] })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soft">Soft</SelectItem>
                <SelectItem value="tight">Tight</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="mirror">Mirror</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.reflection.size]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.reflection.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Distance">
            <NumericField value={[effects.reflection.distance]} min={0} max={50} step={1} onValueChange={([v]) => updateReflection({ distance: v })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>
      <AccordionSection label="Shadow" keywords="outer inner drop blur distance angle color">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Shadow</Label>
        <Switch
          checked={effects.shadow.enabled}
          onCheckedChange={(v) => updateShadow({ enabled: v })}
        />
      </div>
      {effects.shadow.enabled && (
        <div className="space-y-2">
          <PropertyField label="Type">
            <Select value={effects.shadow.type} onValueChange={(v) => updateShadow({ type: v as ShadowEffect['type'] })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outer">Outer</SelectItem>
                <SelectItem value="inner">Inner</SelectItem>
                <SelectItem value="drop">Drop</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Color">
            <ColorInput value={effects.shadow.color} onChange={(v) => updateShadow({ color: v })} />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.shadow.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateShadow({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Blur">
            <NumericField value={[effects.shadow.blur]} min={0} max={50} step={1} onValueChange={([v]) => updateShadow({ blur: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Distance">
            <NumericField value={[effects.shadow.distance]} min={0} max={50} step={1} onValueChange={([v]) => updateShadow({ distance: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Angle">
            <NumericField value={[effects.shadow.angle]} min={0} max={360} step={1} onValueChange={([v]) => updateShadow({ angle: v })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>

      {/* ===== GLOW ===== */}
    </>
  );
}

// Ellipse Properties Panel
function EllipsePropertiesPanel({ element, effectsOnly }: { element: CanvasElement; effectsOnly?: boolean }) {
  const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);

  // Provide safe defaults for effects (backward compat)
  const effects: RectangleEffects = useMemo(() => rawProps.effects ?? { ...DEFAULT_EFFECTS }, [rawProps.effects]);
  const props: EllipseProperties = useMemo(() => ({ ...rawProps, effects }), [rawProps, effects]);

  const update = useCallback((updates: Partial<EllipseProperties>) => {
    updateElementProperties(element.id, {
      type: 'ellipse',
      data: { ...props, ...updates },
    });
  }, [element.id, props, updateElementProperties]);

  const updateEffects = (effectUpdates: Partial<RectangleEffects>) => {
    update({ effects: { ...effects, ...effectUpdates } });
  };

  const updateGradient = (gradientUpdates: Partial<GradientFill>) => {
    updateEffects({ gradient: { ...effects.gradient, ...gradientUpdates } });
  };

  const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
    updateEffects({ shadow: { ...effects.shadow, ...shadowUpdates } });
  };

  const updateReflection = (reflectionUpdates: Partial<ReflectionEffect>) => {
    updateEffects({ reflection: { ...effects.reflection, ...reflectionUpdates } });
  };

  const updateGlow = (glowUpdates: Partial<GlowEffect>) => {
    updateEffects({ glow: { ...effects.glow, ...glowUpdates } });
  };

  const updateGradientStop = (index: number, updates: Partial<GradientStop>) => {
    const newStops = [...effects.gradient.stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateGradient({ stops: newStops });
  };

  const addGradientStop = () => {
    const stops = effects.gradient.stops;
    if (stops.length < 2) {
      updateGradient({ stops: [...stops, { color: '#888888', position: 50, opacity: 1 }] });
      return;
    }
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    let maxGap = 0;
    let gapIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].position - sorted[i].position;
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const newPos = Math.round((sorted[gapIdx].position + sorted[gapIdx + 1].position) / 2);
    const c1 = sorted[gapIdx].color;
    const c2 = sorted[gapIdx + 1].color;
    const mix = (a: number, b: number) => Math.round((a + b) / 2);
    const r = mix(parseInt(c1.slice(1, 3), 16), parseInt(c2.slice(1, 3), 16));
    const g = mix(parseInt(c1.slice(3, 5), 16), parseInt(c2.slice(3, 5), 16));
    const b = mix(parseInt(c1.slice(5, 7), 16), parseInt(c2.slice(5, 7), 16));
    const mixColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    updateGradient({ stops: [...stops, { color: mixColor, position: newPos, opacity: 1 }] });
  };

  const removeGradientStop = (index: number) => {
    if (effects.gradient.stops.length <= 2) return;
    const newStops = effects.gradient.stops.filter((_, i) => i !== index);
    updateGradient({ stops: newStops });
  };

  return (
    <>
      {!effectsOnly && (<>
      {/* ===== FILL ===== */}
      <AccordionSection label="Appearance" keywords="opacity visibility">
      <PropertyField label="Opacity">
        <SliderField
          value={[props.opacity * 100]}
          min={0}
          max={100}
          step={1}
          unit="%"
          colorTheme="gray"
          onValueChange={([v]) => update({ opacity: v / 100 })}
          className="flex-1"
        />
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Border" keywords="width color style dashed dotted">
      <PropertyField label="Width">
        <SliderField
          value={[props.borderWidth]}
          min={0}
          max={10}
          step={1}
          unit="px"
          colorTheme="orange"
          onValueChange={([v]) => update({ borderWidth: v })}
          className="flex-1"
        />
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>
      <PropertyField label="Style">
        <Select value={props.borderStyle} onValueChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>
      </AccordionSection>

      <AccordionSection label="Fill" keywords="solid gradient color stop linear radial direction picture image transparent">
      <GradientStopBar
        gradient={effects.gradient}
        onGradientChange={(updates) => updateGradient(updates)}
      />
      {effects.gradient.type === 'solid' && (
        <PropertyField label="Fill Color">
          <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} />
        </PropertyField>
      )}
      </AccordionSection>
      </>)}

      {/* ===== GLOW ===== */}
      <AccordionSection label="Glow" keywords="glow color size" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Glow</Label>
        <Switch
          checked={effects.glow.enabled}
          onCheckedChange={(v) => updateGlow({ enabled: v })}
        />
      </div>
      {effects.glow.enabled && (
        <div className="space-y-2">
          <PropertyField label="Color">
            <ColorInput value={effects.glow.color} onChange={(v) => updateGlow({ color: v })} />
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.glow.size]} min={1} max={50} step={1} onValueChange={([v]) => updateGlow({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.glow.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateGlow({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
        </div>
      )}

      </AccordionSection>

      {/* ===== REFLECTION ===== */}
      <AccordionSection label="Reflection" keywords="reflection mirror soft tight fade size distance" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">Enable Reflection</Label>
        <Switch
          checked={effects.reflection.enabled}
          onCheckedChange={(v) => updateReflection({ enabled: v })}
        />
      </div>
      {effects.reflection.enabled && (
        <div className="space-y-2">
          <PropertyField label="Preset">
            <Select value={effects.reflection.preset} onValueChange={(v) => updateReflection({ preset: v as ReflectionEffect['preset'] })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soft">Soft</SelectItem>
                <SelectItem value="tight">Tight</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="mirror">Mirror</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>
          <PropertyField label="Size">
            <NumericField value={[effects.reflection.size]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ size: v })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Opacity">
            <NumericField value={[effects.reflection.opacity * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateReflection({ opacity: v / 100 })} className="flex-1" />
          </PropertyField>
          <PropertyField label="Distance">
            <NumericField value={[effects.reflection.distance]} min={0} max={50} step={1} onValueChange={([v]) => updateReflection({ distance: v })} className="flex-1" />
          </PropertyField>
        </div>
      )}
      </AccordionSection>
    </>
  );
}

// ─── Memoized sub-panels ─────────────────────────────────────────────────
// Wrapping each sub-panel in React.memo prevents re-renders when the parent
// PropertiesPanel re-renders due to store changes that don't affect the
// specific element passed to the sub-panel.

const MemoTransformProperties = memo(TransformProperties);
const MemoTextPropertiesPanel = memo(TextPropertiesPanel);
const MemoTableStructurePanel = memo(TableStructurePanel);
const MemoTableStylingPanel = memo(TableStylingPanel);
const MemoImagePropertiesPanel = memo(ImagePropertiesPanel);
const MemoLinePropertiesPanel = memo(LinePropertiesPanel);
const MemoRectangleStyleOnlyPanel = memo(RectangleStyleOnlyPanel);
const MemoRectangleEffectsOnlyPanel = memo(RectangleEffectsOnlyPanel);
const MemoEllipseStyleOnlyPanel = memo(EllipseStyleOnlyPanel);
const MemoEllipseEffectsOnlyPanel = memo(EllipseEffectsOnlyPanel);

// Main Properties Panel
export function PropertiesPanel() {
  const selectedElementId = useDesignerStore((s) => s.selectedElementId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const elements = useDesignerStore((s) => s.elements);
  const findElementById = useDesignerStore((s) => s.findElementById);
  const removeElement = useDesignerStore((s) => s.removeElement);
  const duplicateElement = useDesignerStore((s) => s.duplicateElement);
  const bringToFront = useDesignerStore((s) => s.bringToFront);
  const sendToBack = useDesignerStore((s) => s.sendToBack);
  const toggleLock = useDesignerStore((s) => s.toggleLock);
  const toggleVisibility = useDesignerStore((s) => s.toggleVisibility);
  const updateElement = useDesignerStore((s) => s.updateElement);
  // propertyDisplayMode is no longer read here — the panel is always mounted
  // and the wrapper in page.tsx collapses its width when in 'floating' mode.

  // Search state for filtering properties (Suggestion 7) — must be before early returns
  const [searchTerm, setSearchTerm] = useState('');
  const [manualTab, setManualTab] = useState('layout');

  // Determine which tab has search matches — auto-switch when searching
  const getTabForSearch = useCallback((term: string, elementType: string, hasEffects: boolean, hasStyle: boolean): string | null => {
    if (!term) return null;
    const lower = term.toLowerCase();
    const layoutKw = 'position size alignment structure rows columns table';
    const styleKwMap: Record<string, string> = {
      text: 'text content typography font alignment spacing color',
      table: 'header border corner radius cell defaults backgrounds properties appearance',
      image: 'image source fitting border appearance adjustments brightness contrast',
      line: 'start end point stroke appearance',
      rectangle: 'fill border corner radius appearance',
      ellipse: 'fill border appearance',
    };
    const effectsKw = hasEffects ? 'shadow glow reflection' : '';
    const styleKw = hasStyle ? (styleKwMap[elementType] ?? '') : '';
    if (layoutKw.includes(lower) || layoutKw.split(' ').some(k => k.includes(lower) || lower.includes(k))) return 'layout';
    if (styleKw && (styleKw.includes(lower) || styleKw.split(' ').some(k => k.includes(lower) || lower.includes(k)))) return 'style';
    if (effectsKw && (effectsKw.includes(lower) || effectsKw.split(' ').some(k => k.includes(lower) || lower.includes(k)))) return 'effects';
    return null;
  }, []);

  const element = findElementById(selectedElementId ?? '') ?? elements.find((el) => el.id === selectedElementId);
  const multiSelectCount = selectedElementIds.length;

  // NOTE: In 'floating' mode the side panel is hidden via a width/opacity
  // transition handled by the wrapper in page.tsx (so it animates smoothly
  // rather than popping in/out). We no longer return null here — the panel
  // always renders its content, and the wrapper collapses its width to 0
  // when propertyDisplayMode === 'floating'. This keeps the panel mounted
  // during the transition so the exit animation is visible.

  if (multiSelectCount > 1) {
    // Multi-select alignment mirrors the floating-card method: only two
    // actions — horizontal center and vertical center — aligning the whole
    // selection as a BLOCK (preserving relative positions). The edge aligns
    // (left/right/top/bottom) are intentionally NOT shown here, matching the
    // card method's multi-select Alignment card.
    const alignElementsHorizontalCenter = useDesignerStore.getState().alignElementsHorizontalCenter;
    const alignElementsVerticalCenter = useDesignerStore.getState().alignElementsVerticalCenter;
    const ids = [...selectedElementIds];

    return (
      <div data-ui-panel className="w-72 border-l border-border bg-card flex flex-col h-full">
        <div className="p-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Properties</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {/* Selection info */}
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">{multiSelectCount} elements selected</p>
            </div>

            {/* Alignment tools — block-align center only (matches card method) */}
            <AccordionSection label="Alignment" keywords="center horizontal vertical align">
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={() => alignElementsHorizontalCenter(ids)} title="Align Center Horizontal">
                  <AlignCenterVertical className="h-3.5 w-3.5" /> H-Center
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={() => alignElementsVerticalCenter(ids)} title="Align Center Vertical">
                  <AlignCenterHorizontal className="h-3.5 w-3.5" /> V-Center
                </Button>
              </div>
            </AccordionSection>

            {/* Common operations */}
            <AccordionSection label="Operations" keywords="delete lock unlock hide show duplicate">
              <div className="space-y-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] w-full gap-1 text-destructive hover:text-destructive"
                  onClick={() => {
                    for (const id of [...selectedElementIds]) removeElement(id);
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Delete All
                </Button>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] flex-1 gap-1"
                    onClick={() => {
                      for (const id of selectedElementIds) toggleLock(id);
                    }}
                  >
                    <Lock className="h-3 w-3" /> Lock All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] flex-1 gap-1"
                    onClick={() => {
                      for (const id of selectedElementIds) toggleLock(id);
                    }}
                  >
                    <Unlock className="h-3 w-3" /> Unlock
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] flex-1 gap-1"
                    onClick={() => {
                      for (const id of selectedElementIds) {
                        const el = elements.find((e) => e.id === id);
                        if (el && el.visible) toggleVisibility(id);
                      }
                    }}
                  >
                    <EyeOff className="h-3 w-3" /> Hide All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] flex-1 gap-1"
                    onClick={() => {
                      for (const id of selectedElementIds) {
                        const el = elements.find((e) => e.id === id);
                        if (el && !el.visible) toggleVisibility(id);
                      }
                    }}
                  >
                    <Eye className="h-3 w-3" /> Show All
                  </Button>
                </div>
              </div>
            </AccordionSection>
          </div>
        </ScrollArea>
      </div>
    );
  }

  if (!element) {
    return (
      <div data-ui-panel className="w-72 border-l border-border bg-card flex flex-col h-full">
        <div className="p-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
              <MousePointerIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Select an element to edit its properties</p>
          </div>
        </div>
      </div>
    );
  }

  // NOTE: Sub-panel wrappers are intentionally NOT defined inside this render function.
  // Defining components inside render creates new function refs each render, causing
  // React to unmount/remount them — which resets scroll position in the tabs.

  // Determine which tabs are applicable
  const hasEffects = element.type === 'rectangle' || element.type === 'ellipse';
  const hasStyle = element.type !== 'group'; // Group has no style properties

  // Auto-switch tab when searching
  const activeTab = searchTerm ? (getTabForSearch(searchTerm, element.type, hasEffects, hasStyle) ?? manualTab) : manualTab;

  return (
    <SearchContext.Provider value={searchTerm}>
    <div data-ui-panel className="w-72 border-l border-border bg-card flex flex-col h-full">
      {/* Fixed header — Search Bar at top */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
        <SearchBar value={searchTerm} onChange={setSearchTerm} />
      </div>

      {/* Tabs — fills remaining space */}
      <Tabs key={element.id} value={activeTab} onValueChange={setManualTab} className="w-full flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="px-3 pt-2 pb-0 border-b border-border shrink-0">
          <TabsList className="w-full h-7 p-0">
            <TabsTrigger value="layout" className="text-[10px] h-6 flex-1">Layout</TabsTrigger>
            <TabsTrigger value="style" className={`text-[10px] h-6 flex-1 ${!hasStyle ? 'opacity-40 pointer-events-none' : ''}`}>Style</TabsTrigger>
            <TabsTrigger
              value="effects"
              className={`text-[10px] h-6 flex-1 ${!hasEffects ? 'opacity-40 pointer-events-none' : ''}`}
            >
              Effects
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Element name — below tabs */}
        <div className="px-3 pt-2 pb-1 shrink-0">
          <div className="flex items-center gap-2">
            {typeIcons[element.type]}
            <div className="flex-1 min-w-0">
              <Input
                value={element.name}
                onChange={(e) => updateElement(element.id, { name: e.target.value })}
                className="h-7 text-sm font-semibold px-1 py-0"
              />
            </div>
          </div>
        </div>

        {/* Layout Tab */}
        <TabsContent value="layout" className="mt-0 flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
          <div className="p-3 space-y-1">
                {/* Action buttons */}
                <div className="flex items-center gap-1 mb-3">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => duplicateElement(element.id)} title="Duplicate" aria-label="Duplicate element">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => toggleLock(element.id)} title={element.locked ? 'Unlock' : 'Lock'} aria-label={element.locked ? 'Unlock element' : 'Lock element'}>
                    {element.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => toggleVisibility(element.id)} title={element.visible ? 'Hide' : 'Show'} aria-label={element.visible ? 'Hide element' : 'Show element'}>
                    {element.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                  <div className="w-px h-4 bg-border mx-0.5" />
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => bringToFront(element.id)} title="Bring to front" aria-label="Bring to front">
                    <ArrowUpToLine className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => sendToBack(element.id)} title="Send to back" aria-label="Send to back">
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  </Button>
                  <div className="flex-1" />
                  <Button variant="outline" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeElement(element.id)} title="Delete" aria-label="Delete element">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Transform properties */}
                <MemoTransformProperties element={element} />

                {/* Table structure */}
                {element.type === 'table' && (
                  <MemoTableStructurePanel element={element} />
                )}
            </div>
        </TabsContent>

        {/* Style Tab */}
        <TabsContent value="style" className="mt-0 flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
          <div className="p-3 space-y-1">
                {element.type === 'text' && <MemoTextPropertiesPanel element={element} />}
                {element.type === 'table' && <MemoTableStylingPanel element={element} />}
                {element.type === 'image' && <MemoImagePropertiesPanel element={element} />}
                {element.type === 'line' && <MemoLinePropertiesPanel element={element} />}
                {element.type === 'rectangle' && <MemoRectangleStyleOnlyPanel element={element} />}
                {element.type === 'ellipse' && <MemoEllipseStyleOnlyPanel element={element} />}
            </div>
        </TabsContent>

        {/* Effects Tab */}
        <TabsContent value="effects" className="mt-0 flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
          {hasEffects ? (
            <div className="p-3 space-y-1">
                  {element.type === 'rectangle' && <MemoRectangleEffectsOnlyPanel element={element} />}
                  {element.type === 'ellipse' && <MemoEllipseEffectsOnlyPanel element={element} />}
            </div>
          ) : (
            <div className="flex items-center justify-center p-8">
              <p className="text-xs text-muted-foreground">No effects available for this element type</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
    </SearchContext.Provider>
  );
}

function MousePointerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  );
}

// ─── Extracted sub-panels for tabbed layout ─────────────────────────────

// Table structure panel (rows/cols/add/remove/reorder)
function TableStructurePanel({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const [removeRowIdx, setRemoveRowIdx] = useState<number>(0);
  const [removeColIdx, setRemoveColIdx] = useState<number>(0);

  const legacyOuter = rawProps.showOuterBorder;
  const legacyInner = rawProps.showInnerBorder;
  const props: TableProperties = {
    rows: rawProps.rows ?? 4,
    cols: rawProps.cols ?? 3,
    cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
    cellOverrides: rawProps.cellOverrides ?? {},
    showHeader: rawProps.showHeader ?? true,
    headerBg: rawProps.headerBg ?? '#f3f4f6',
    headerColor: rawProps.headerColor ?? '#111827',
    headerFontWeight: rawProps.headerFontWeight ?? 'bold',
    cellBg: rawProps.cellBg ?? '#ffffff',
    cellColor: rawProps.cellColor ?? '#374151',
    cellPadding: rawProps.cellPadding ?? 8,
    fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
    fontSize: rawProps.fontSize ?? 13,
    rowBgColors: rawProps.rowBgColors ?? {},
    colBgColors: rawProps.colBgColors ?? {},
    borderWidth: rawProps.borderWidth ?? 1,
    borderStyle: rawProps.borderStyle ?? 'solid',
    borderColor: rawProps.borderColor ?? '#d1d5db',
    showBorderTop: rawProps.showBorderTop ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderRight: rawProps.showBorderRight ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderBottom: rawProps.showBorderBottom ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderLeft: rawProps.showBorderLeft ?? (legacyOuter !== undefined ? legacyOuter : true),
    showInnerBorders: rawProps.showInnerBorders ?? (legacyInner !== undefined ? legacyInner : true),
    cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
    rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
    rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
    colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
    opacity: rawProps.opacity ?? 1,
  };

  const update = (updates: Partial<TableProperties>) => {
    updateElementProperties(element.id, {
      type: 'table',
      data: { ...props, ...updates },
    });
  };

  const addRow = () => {
    // Read latest data from store to avoid stale closure issues
    const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
    const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
    const newRow = Array(currentData.cols).fill('');
    const newCellData = [...currentData.cellData.map((r) => [...r]), newRow];
    const newRowHeights = [...(currentData.rowHeights ?? Array(currentData.rows).fill(1)), 1];
    const newRowNames = [...(currentData.rowNames ?? Array.from({ length: currentData.rows }, (_, i) => `Row ${i + 1}`)), `Row ${currentData.rows + 1}`];
    update({ rows: currentData.rows + 1, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
  };

  const addColumn = () => {
    // Read latest data from store to avoid stale closure issues
    const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
    const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
    const newCellData = currentData.cellData.map((row) => [...row, '']);
    const newColWidths = [...(currentData.colWidths ?? Array(currentData.cols).fill(1)), 1];
    const newColNames = [...(currentData.colNames ?? Array.from({ length: currentData.cols }, (_, i) => `Column ${i + 1}`)), `Column ${currentData.cols + 1}`];
    update({ cols: currentData.cols + 1, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
  };

  const removeRow = (idx: number) => {
    if (props.rows <= 1) return;
    const newCellData = props.cellData.filter((_, i) => i !== idx);
    const newOverrides: Record<string, CellOverride> = {};
    for (const [key, val] of Object.entries(props.cellOverrides)) {
      const [r, c] = key.split('-').map(Number);
      if (r === idx) continue;
      const newR = r > idx ? r - 1 : r;
      newOverrides[`${newR}-${c}`] = val;
    }
    const newRowBg: Record<number, string> = {};
    for (const [k, v] of Object.entries(props.rowBgColors)) {
      const r = Number(k);
      if (r === idx) continue;
      const newR = r > idx ? r - 1 : r;
      newRowBg[newR] = v;
    }
    // Remove the row height entry at idx
    const rowHeights = props.rowHeights ?? Array(props.rows).fill(1);
    const newRowHeights = rowHeights.filter((_, i) => i !== idx);
    const newRowNames = (props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`)).filter((_, i) => i !== idx);
    update({ rows: props.rows - 1, cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowHeights: newRowHeights, rowNames: newRowNames });
    setRemoveRowIdx(Math.max(0, Math.min(removeRowIdx, props.rows - 2)));
  };

  const removeColumn = (idx: number) => {
    if (props.cols <= 1) return;
    const newCellData = props.cellData.map((row) => row.filter((_, i) => i !== idx));
    const newOverrides: Record<string, CellOverride> = {};
    for (const [key, val] of Object.entries(props.cellOverrides)) {
      const [r, c] = key.split('-').map(Number);
      if (c === idx) continue;
      const newC = c > idx ? c - 1 : c;
      newOverrides[`${r}-${newC}`] = val;
    }
    const newColBg: Record<number, string> = {};
    for (const [k, v] of Object.entries(props.colBgColors)) {
      const c = Number(k);
      if (c === idx) continue;
      const newC = c > idx ? c - 1 : c;
      newColBg[newC] = v;
    }
    // Remove the col width entry at idx
    const colWidths = props.colWidths ?? Array(props.cols).fill(1);
    const newColWidths = colWidths.filter((_, i) => i !== idx);
    const newColNames = (props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`)).filter((_, i) => i !== idx);
    update({ cols: props.cols - 1, cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colWidths: newColWidths, colNames: newColNames });
    setRemoveColIdx(Math.max(0, Math.min(removeColIdx, props.cols - 2)));
  };

  // Drag-and-drop reorder handlers (arbitrary from→to)
  const handleRowReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCellData = props.cellData.map((r) => [...r]);
    const [moved] = newCellData.splice(fromIndex, 1);
    newCellData.splice(toIndex, 0, moved);
    const newOverrides = remapOverridesForInsertion(props.cellOverrides, fromIndex, toIndex, 'row');
    const newRowBg = remapRowBgForInsertion(props.rowBgColors, fromIndex, toIndex);
    // Reorder rowHeights
    const rowHeights = props.rowHeights ?? Array(props.rows).fill(1);
    const newRowHeights = [...rowHeights];
    const [movedH] = newRowHeights.splice(fromIndex, 1);
    newRowHeights.splice(toIndex, 0, movedH);
    // Reorder rowNames
    const rowNames = [...(props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`))];
    const [movedRowName] = rowNames.splice(fromIndex, 1);
    rowNames.splice(toIndex, 0, movedRowName);
    update({ cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowHeights: newRowHeights, rowNames });
  }, [props.cellData, props.cellOverrides, props.rowBgColors, props.rowHeights, props.rowNames, props.rows, update]);

  const handleColReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCellData = props.cellData.map((row) => {
      const newRow = [...row];
      const [moved] = newRow.splice(fromIndex, 1);
      newRow.splice(toIndex, 0, moved);
      return newRow;
    });
    const newOverrides = remapOverridesForInsertion(props.cellOverrides, fromIndex, toIndex, 'col');
    const newColBg = remapColBgForInsertion(props.colBgColors, fromIndex, toIndex);
    // Reorder colWidths
    const colWidths = props.colWidths ?? Array(props.cols).fill(1);
    const newColWidths = [...colWidths];
    const [movedW] = newColWidths.splice(fromIndex, 1);
    newColWidths.splice(toIndex, 0, movedW);
    // Reorder colNames
    const colNames = [...(props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`))];
    const [movedColName] = colNames.splice(fromIndex, 1);
    colNames.splice(toIndex, 0, movedColName);
    update({ cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colWidths: newColWidths, colNames });
  }, [props.cellData, props.cellOverrides, props.colBgColors, props.colWidths, props.colNames, props.cols, update]);

  return (
    <>
      <AccordionSection label="Reorder Column" defaultOpen={false}>
        <DraggableReorderList
          items={Array.from({ length: props.cols }, (_, i) => ({
            id: `col-${i}`,
            label: (props.colNames ?? Array.from({ length: props.cols }, (_, j) => `Column ${j + 1}`))[i],
            color: props.colBgColors[i] || undefined,
          }))}
          onReorder={handleColReorder}
        />
      </AccordionSection>
      <AccordionSection label="Reorder Row" defaultOpen={false}>
        <DraggableReorderList
          items={props.cellData.map((_, i) => ({
            id: `row-${i}`,
            label: (props.rowNames ?? Array.from({ length: props.cellData.length }, (_, j) => `Row ${j + 1}`))[i],
            color: props.rowBgColors[i] || undefined,
          }))}
          onReorder={handleRowReorder}
        />
      </AccordionSection>

      <AccordionSection label="Remove Column" defaultOpen={false}>
        <div className="flex gap-1">
          <Select value={String(removeColIdx)} onValueChange={(v) => setRemoveColIdx(+v)}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: props.cols }, (_, i) => (
                <SelectItem key={i} value={String(i)}>{(props.colNames ?? Array.from({ length: props.cols }, (_, j) => `Column ${j + 1}`))[i]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0" onClick={() => removeColumn(removeColIdx)} disabled={props.cols <= 1}>
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        </div>
      </AccordionSection>

      <AccordionSection label="Remove Row" defaultOpen={false}>
        <div className="flex gap-1">
          <Select value={String(removeRowIdx)} onValueChange={(v) => setRemoveRowIdx(+v)}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {props.cellData.map((_, i) => (
                <SelectItem key={i} value={String(i)}>{(props.rowNames ?? Array.from({ length: props.cellData.length }, (_, j) => `Row ${j + 1}`))[i]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive shrink-0" onClick={() => removeRow(removeRowIdx)} disabled={props.rows <= 1}>
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        </div>
      </AccordionSection>

      <AccordionSection label="Structure" keywords="rows columns add remove row col">
      <PropertyPair
        label1="Rows"
        child1={
          <Input type="number" min={1} max={50} value={props.rows}
            onChange={(e) => {
              const newRows = Math.max(1, +e.target.value);
              const newCellData: string[][] = [];
              for (let r = 0; r < newRows; r++) {
                newCellData[r] = [];
                for (let c = 0; c < props.cols; c++) {
                  newCellData[r][c] = props.cellData[r]?.[c] || '';
                }
              }
              // Keep rowHeights / rowNames aligned with the new row count so
              // the reorder list, names, and column/row adjustment all stay in
              // sync (no blank names, no reset of custom widths/heights).
              const oldRowHeights = props.rowHeights ?? Array(props.rows).fill(1);
              const newRowHeights = Array.from({ length: newRows }, (_, i) => oldRowHeights[i] ?? 1);
              const oldRowNames = props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`);
              const newRowNames = Array.from({ length: newRows }, (_, i) => oldRowNames[i] ?? `Row ${i + 1}`);
              update({ rows: newRows, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
            }}
            className="h-7 text-xs"
          />
        }
        label2="Columns"
        child2={
          <Input type="number" min={1} max={20} value={props.cols}
            onChange={(e) => {
              const newCols = Math.max(1, +e.target.value);
              const newCellData = props.cellData.map((row) => {
                const newRow: string[] = [];
                for (let c = 0; c < newCols; c++) {
                  newRow[c] = row[c] || '';
                }
                return newRow;
              });
              // Keep colWidths / colNames aligned with the new col count so
              // the reorder list, names, and column/row adjustment all stay in
              // sync (no blank names, no reset of custom widths/heights).
              const oldColWidths = props.colWidths ?? Array(props.cols).fill(1);
              const newColWidths = Array.from({ length: newCols }, (_, i) => oldColWidths[i] ?? 1);
              const oldColNames = props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`);
              const newColNames = Array.from({ length: newCols }, (_, i) => oldColNames[i] ?? `Column ${i + 1}`);
              update({ cols: newCols, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
            }}
            className="h-7 text-xs"
          />
        }
      />
      <div className="flex gap-1 mt-1">
        <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={addRow}>
          <Plus className="h-3 w-3" /> Row
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 gap-1" onClick={addColumn}>
          <Plus className="h-3 w-3" /> Col
        </Button>
      </div>
      </AccordionSection>

    </>
  );
}

// Table styling panel (everything except structure)
function TableStylingPanel({ element }: { element: CanvasElement }) {
  // Reuse the full TablePropertiesPanel which already has all the styling sections
  // For now, just render the full panel - it's comprehensive
  return <TablePropertiesPanel element={element} />;
}

// Rectangle style-only panel
function RectangleStyleOnlyPanel({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const setRectRotation = useDesignerStore((s) => s.setRectRotation);
  const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
  const props: RectangleProperties = { ...rawProps, effects };

  const update = (updates: Partial<RectangleProperties>) => {
    updateElementProperties(element.id, {
      type: 'rectangle',
      data: { ...props, ...updates },
    });
  };

  const updateGradient = (gradientUpdates: Partial<GradientFill>) => {
    update({ effects: { ...effects, gradient: { ...effects.gradient, ...gradientUpdates } } });
  };

  const updateGradientStop = (index: number, updates: Partial<GradientStop>) => {
    const newStops = [...effects.gradient.stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateGradient({ stops: newStops });
  };

  const addGradientStop = () => {
    const stops = effects.gradient.stops;
    if (stops.length < 2) {
      updateGradient({ stops: [...stops, { color: '#888888', position: 50, opacity: 1 }] });
      return;
    }
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    let maxGap = 0;
    let gapIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].position - sorted[i].position;
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const newPos = Math.round((sorted[gapIdx].position + sorted[gapIdx + 1].position) / 2);
    const c1 = sorted[gapIdx].color;
    const c2 = sorted[gapIdx + 1].color;
    const mix = (a: number, b: number) => Math.round((a + b) / 2);
    const r = mix(parseInt(c1.slice(1, 3), 16), parseInt(c2.slice(1, 3), 16));
    const g = mix(parseInt(c1.slice(3, 5), 16), parseInt(c2.slice(3, 5), 16));
    const b = mix(parseInt(c1.slice(5, 7), 16), parseInt(c2.slice(5, 7), 16));
    const mixColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    updateGradient({ stops: [...stops, { color: mixColor, position: newPos, opacity: 1 }] });
  };

  const removeGradientStop = (index: number) => {
    if (effects.gradient.stops.length <= 2) return;
    const newStops = effects.gradient.stops.filter((_, i) => i !== index);
    updateGradient({ stops: newStops });
  };

  return (
    <>
      {/* Fill */}
      <AccordionSection label="Border" keywords="width color style dashed dotted">
      <PropertyField label="Width">
        <SliderField value={[props.borderWidth]} min={0} max={10} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} className="flex-1" />
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>
      <PropertyField label="Style">
        <Select value={props.borderStyle} onValueChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>

      </AccordionSection>

      {/* Corner Radius */}
      <AccordionSection label="Corner Radius" keywords="corner radius rounded border radius tl tr bl br">
      {(() => {
        const cr = normalizeRectBorderRadius(props.borderRadius);
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {cr.mode === 'linked' ? 'All Corners' : 'Individual Corners'}
              </Label>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1"
                onClick={() => {
                  if (cr.mode === 'linked') {
                    update({ borderRadius: { ...cr, mode: 'individual', topLeft: cr.all, topRight: cr.all, bottomRight: cr.all, bottomLeft: cr.all } });
                  } else {
                    const avg = Math.round((cr.topLeft + cr.topRight + cr.bottomRight + cr.bottomLeft) / 4);
                    update({ borderRadius: { ...cr, mode: 'linked', all: avg, topLeft: avg, topRight: avg, bottomRight: avg, bottomLeft: avg } });
                  }
                }}
              >
                {cr.mode === 'linked' ? <><Link className="h-3 w-3" /> Linked</> : <><Link2Off className="h-3 w-3" /> Individual</>}
              </Button>
            </div>
            {cr.mode === 'linked' ? (
              <SliderField value={[cr.all]} min={0} max={100} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ borderRadius: { ...cr, all: v, topLeft: v, topRight: v, bottomRight: v, bottomLeft: v } })} className="flex-1" />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1"><Label className="text-[9px] text-muted-foreground w-6 shrink-0">TL</Label><Input type="number" min={0} max={100} value={cr.topLeft} onChange={(e) => { const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0)); update({ borderRadius: { ...cr, topLeft: v } }); }} className="h-6 text-xs flex-1" /></div>
                <div className="flex items-center gap-1"><Label className="text-[9px] text-muted-foreground w-6 shrink-0">TR</Label><Input type="number" min={0} max={100} value={cr.topRight} onChange={(e) => { const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0)); update({ borderRadius: { ...cr, topRight: v } }); }} className="h-6 text-xs flex-1" /></div>
                <div className="flex items-center gap-1"><Label className="text-[9px] text-muted-foreground w-6 shrink-0">BL</Label><Input type="number" min={0} max={100} value={cr.bottomLeft} onChange={(e) => { const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0)); update({ borderRadius: { ...cr, bottomLeft: v } }); }} className="h-6 text-xs flex-1" /></div>
                <div className="flex items-center gap-1"><Label className="text-[9px] text-muted-foreground w-6 shrink-0">BR</Label><Input type="number" min={0} max={100} value={cr.bottomRight} onChange={(e) => { const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0)); update({ borderRadius: { ...cr, bottomRight: v } }); }} className="h-6 text-xs flex-1" /></div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Opacity */}
      <PropertyField label="Opacity">
        <SliderField value={[props.opacity * 100]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} className="flex-1" />
      </PropertyField>
      </AccordionSection>
      {/* ===== TRANSFORM (rotation) ===== */}
      {/* Mirrors the Transform section in the right-side RectanglePropertiesPanel
          so users can adjust rotation from the floating "Style" card too.
          Only rectangles support rotation (per spec). The slider covers the
          full [-180, 180] range at 1° resolution; the numeric input lets the
          user type an exact value. The reset button restores 0°. The store's
          setRectRotation action normalizes the angle to [-180, 180] before
          writing, so the displayed value stays bounded even if the user types
          something like 540°. */}
      <AccordionSection label="Transform" keywords="rotation rotate angle spin turn degrees">
      <PropertyField label="Rotation">
        <div className="flex items-center gap-2 w-full">
          <SliderField
            value={[getRectRotation(element)]}
            min={-180}
            max={180}
            step={1}
            unit="°"
            colorTheme="purple"
            onValueChange={([v]) => setRectRotation(element.id, v)}
            className="flex-1"
          />
          <NumericField
            value={[getRectRotation(element)]}
            min={-180}
            max={180}
            step={1}
            onValueChange={([v]) => setRectRotation(element.id, v)}
            className="w-16"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            title="Reset rotation to 0°"
            onClick={() => setRectRotation(element.id, 0)}
            disabled={getRectRotation(element) === 0}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Fill" keywords="solid gradient color stop linear radial direction picture image transparent">
      <GradientStopBar
        gradient={effects.gradient}
        onGradientChange={(updates) => updateGradient(updates)}
      />
      {effects.gradient.type === 'solid' && (
        <PropertyField label="Fill Color">
          <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} />
        </PropertyField>
      )}
      </AccordionSection>

      {/* Border */}
    </>
  );
}

// Rectangle effects-only panel
function RectangleEffectsOnlyPanel({ element }: { element: CanvasElement }) {
  return <RectanglePropertiesPanel element={element} effectsOnly />;
}

// Ellipse style-only panel
function EllipseStyleOnlyPanel({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
  const props: EllipseProperties = { ...rawProps, effects };

  const update = (updates: Partial<EllipseProperties>) => {
    updateElementProperties(element.id, {
      type: 'ellipse',
      data: { ...props, ...updates },
    });
  };

  const updateGradient = (gradientUpdates: Partial<GradientFill>) => {
    update({ effects: { ...effects, gradient: { ...effects.gradient, ...gradientUpdates } } });
  };

  const updateGradientStop = (index: number, updates: Partial<GradientStop>) => {
    const newStops = [...effects.gradient.stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateGradient({ stops: newStops });
  };

  const addGradientStop = () => {
    const stops = effects.gradient.stops;
    if (stops.length < 2) {
      updateGradient({ stops: [...stops, { color: '#888888', position: 50, opacity: 1 }] });
      return;
    }
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    let maxGap = 0;
    let gapIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].position - sorted[i].position;
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const newPos = Math.round((sorted[gapIdx].position + sorted[gapIdx + 1].position) / 2);
    const c1 = sorted[gapIdx].color;
    const c2 = sorted[gapIdx + 1].color;
    const mix = (a: number, b: number) => Math.round((a + b) / 2);
    const r = mix(parseInt(c1.slice(1, 3), 16), parseInt(c2.slice(1, 3), 16));
    const g = mix(parseInt(c1.slice(3, 5), 16), parseInt(c2.slice(3, 5), 16));
    const b = mix(parseInt(c1.slice(5, 7), 16), parseInt(c2.slice(5, 7), 16));
    const mixColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    updateGradient({ stops: [...stops, { color: mixColor, position: newPos, opacity: 1 }] });
  };

  const removeGradientStop = (index: number) => {
    if (effects.gradient.stops.length <= 2) return;
    const newStops = effects.gradient.stops.filter((_, i) => i !== index);
    updateGradient({ stops: newStops });
  };

  return (
    <>
      <AccordionSection label="Appearance" keywords="opacity visibility">
      <PropertyField label="Opacity">
        <SliderField value={[props.opacity * 100]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} className="flex-1" />
      </PropertyField>
      </AccordionSection>
      <AccordionSection label="Border" keywords="width color style dashed dotted">
      <PropertyField label="Width">
        <SliderField value={[props.borderWidth]} min={0} max={10} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} className="flex-1" />
      </PropertyField>
      <PropertyField label="Color">
        <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} />
      </PropertyField>
      <PropertyField label="Style">
        <Select value={props.borderStyle} onValueChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
            <SelectItem value="dotted">Dotted</SelectItem>
          </SelectContent>
        </Select>
      </PropertyField>

      </AccordionSection>

      <AccordionSection label="Fill" keywords="solid gradient color stop linear radial direction picture image transparent">
      <GradientStopBar
        gradient={effects.gradient}
        onGradientChange={(updates) => updateGradient(updates)}
      />
      {effects.gradient.type === 'solid' && (
        <PropertyField label="Fill Color">
          <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} />
        </PropertyField>
      )}
      </AccordionSection>

    </>
  );
}

// Ellipse effects-only panel
function EllipseEffectsOnlyPanel({ element }: { element: CanvasElement }) {
  return <EllipsePropertiesPanel element={element} effectsOnly />;
}
