import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { Palette, TypographyVariant } from '@/theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: keyof Palette;
  /** Tabular numerals so time and money don't jitter as digits change. */
  numeric?: boolean;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', color = 'text', numeric, align, style, ...rest }: TextProps) {
  const t = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={variant === 'timer' ? 1.3 : 1.8}
      {...rest}
      style={[
        t.typography[variant],
        { color: t.colors[color], textAlign: align },
        variant === 'overline' && { textTransform: 'uppercase' },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}
