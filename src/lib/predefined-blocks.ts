// ── Predefined Blocks for Invoice Designer ──────────────────────────────────
// Each block defines a label, icon hint, description, default text content
// (with formatting), and default text properties (font size, weight, etc.)
// When inserted, these become standard text elements on the canvas.

export interface PredefinedBlock {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  // The HTML content that will be set as the text element's content
  content: string;
  // Default text properties overrides (merged over the standard text defaults)
  properties: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    textTransform?: string;
    color?: string;
    textAlign?: 'left' | 'center' | 'right';
    lineHeight?: number;
    letterSpacing?: number;
  };
  // Suggested width/height for the element
  width: number;
  height: number;
}

export const PREDEFINED_BLOCKS: PredefinedBlock[] = [
  {
    id: 'heading',
    label: 'Heading',
    description: 'Large invoice heading title',
    icon: 'Heading',
    content: '<p><strong>INVOICE</strong></p>',
    properties: {
      fontSize: 36,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#1a1a1a',
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    width: 300,
    height: 55,
  },
  {
    id: 'company-info',
    label: 'Company Info',
    description: 'Your company name, address, and contact details',
    icon: 'Building2',
    content: '<p><strong>[Your Company Name]</strong></p><p>[Street Address]</p><p>[City, State, ZIP Code]</p><p>Phone: [000-000-0000]</p><p>Email: [email@example.com]</p><p>Website: [www.example.com]</p>',
    properties: {
      fontSize: 12,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.6,
    },
    width: 240,
    height: 120,
  },
  {
    id: 'address',
    label: 'Address Block',
    description: 'Recipient address with name and location',
    icon: 'MapPin',
    content: '<p><strong>[Recipient Name]</strong></p><p>[Street Address]</p><p>[City, State, ZIP Code]</p><p>[Country]</p>',
    properties: {
      fontSize: 13,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.6,
    },
    width: 220,
    height: 90,
  },
  {
    id: 'customer-info',
    label: 'Customer Info',
    description: 'Bill-to section with customer details',
    icon: 'User',
    content: '<p><strong>Bill To:</strong></p><p>[Customer Name]</p><p>[Street Address]</p><p>[City, State, ZIP Code]</p><p>[Country]</p>',
    properties: {
      fontSize: 13,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.6,
    },
    width: 220,
    height: 100,
  },
  {
    id: 'date',
    label: 'Date Block',
    description: 'Invoice date with placeholder',
    icon: 'Calendar',
    content: '<p><strong>Date:</strong> [DD/MM/YYYY]</p>',
    properties: {
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.5,
    },
    width: 200,
    height: 30,
  },
  {
    id: 'invoice-number',
    label: 'Invoice Number',
    description: 'Invoice number with placeholder',
    icon: 'Hash',
    content: '<p><strong>Invoice No:</strong> [#000000]</p>',
    properties: {
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.5,
    },
    width: 200,
    height: 30,
  },
  {
    id: 'signature',
    label: 'Signature Block',
    description: 'Authorized signature line with label',
    icon: 'PenLine',
    content: '<p>Authorized Signature:</p><p>_____________________________</p>',
    properties: {
      fontSize: 13,
      fontFamily: 'Inter, sans-serif',
      color: '#374151',
      textAlign: 'left',
      lineHeight: 1.8,
    },
    width: 240,
    height: 55,
  },
  {
    id: 'terms',
    label: 'Terms & Conditions',
    description: 'Standard payment terms and conditions',
    icon: 'FileText',
    content: '<p><strong>Terms &amp; Conditions:</strong></p><p>Payment is due within 30 days from the invoice date.</p><p>Late payments may be subject to additional fees.</p><p>Goods and services are provided as agreed upon.</p><p>Please contact us if you have any questions regarding this invoice.</p>',
    properties: {
      fontSize: 10,
      fontFamily: 'Inter, sans-serif',
      color: '#6b7280',
      textAlign: 'left',
      lineHeight: 1.6,
    },
    width: 320,
    height: 120,
  },
  {
    id: 'footer',
    label: 'Footer Block',
    description: 'Thank you message for the invoice',
    icon: 'Heart',
    content: '<p><em>Thank you for your business!</em></p>',
    properties: {
      fontSize: 13,
      fontFamily: 'Inter, sans-serif',
      fontStyle: 'italic',
      color: '#6b7280',
      textAlign: 'center',
      lineHeight: 1.5,
    },
    width: 240,
    height: 30,
  },
];
