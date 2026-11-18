import type { TextStyle } from 'react-native';

/**
 * ShiftMate design tokens. All UI colour/spacing/type comes from here —
 * components never hardcode values. Swap palette values to rebrand.
 */

export interface Palette {
  background: string;
  surface: string; // secondary background (grouped sections, tab bar)
  card: string;
  cardElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSecondary: string;
  accentMuted: string; // tinted fill behind accent content
  onAccent: string;
  success: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  overlay: string;
  shadow: string;
}

export const darkPalette: Palette = {
  background: '#0B0D0F',
  surface: '#14181C',
  card: '#191F23',
  cardElevated: '#1F262B',
  border: '#252C32',
  borderStrong: '#323B42',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  accent: '#10B981',
  accentSecondary: '#34D399',
  accentMuted: 'rgba(16, 185, 129, 0.14)',
  onAccent: '#04130D',
  success: '#34D399',
  warning: '#FBBF24',
  warningMuted: 'rgba(251, 191, 36, 0.14)',
  danger: '#F87171',
  dangerMuted: 'rgba(248, 113, 113, 0.14)',
  info: '#60A5FA',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

export const lightPalette: Palette = {
  background: '#F7F8FA',
  surface: '#EEF0F3',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  text: '#17202A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  accent: '#059669',
  accentSecondary: '#10B981',
  accentMuted: 'rgba(5, 150, 105, 0.10)',
  onAccent: '#FFFFFF',
  success: '#059669',
  warning: '#B45309',
  warningMuted: 'rgba(180, 83, 9, 0.10)',
  danger: '#DC2626',
  dangerMuted: 'rgba(220, 38, 38, 0.08)',
  info: '#2563EB',
  overlay: 'rgba(15, 23, 42, 0.4)',
  shadow: '#0F172A',
};

/** Employer identity colours — distinguishable in both themes. */
export const JOB_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316', '#64748B'];

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 } as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

type TypeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'>;

export const typography = {
  timer: { fontFamily: fonts.semibold, fontSize: 60, lineHeight: 68, letterSpacing: -2 },
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  title: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, letterSpacing: -0.1 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  stat: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
} satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

export const motion = { fast: 150, base: 220, slow: 320 } as const;

/** Minimum touch target (Apple HIG 44pt / Material 48dp). */
export const HIT_TARGET = 48;

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fonts: typeof fonts;
}

export const makeTheme = (scheme: 'light' | 'dark'): Theme => ({
  scheme,
  colors: scheme === 'dark' ? darkPalette : lightPalette,
  spacing,
  radius,
  typography,
  fonts,
});
