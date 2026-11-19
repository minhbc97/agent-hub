import betterTailwind from 'eslint-plugin-better-tailwindcss';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist', 'data', 'node_modules'] },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: betterTailwind.configs.recommended.plugins,
    settings: { 'better-tailwindcss': { entryPoint: 'src/web/index.css', tsconfig: 'tsconfig.app.json' } },
    rules: {
      ...betterTailwind.configs.recommended.rules,
      // Prettier owns class order and line wrapping.
      'better-tailwindcss/enforce-consistent-class-order': 'off',
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      // html font-size is 14px (index.css); the default 16 would suggest px->rem swaps that change layout.
      'better-tailwindcss/enforce-canonical-classes': ['warn', { rootFontSize: 14 }],
      // sonner's hook class, not a Tailwind utility.
      'better-tailwindcss/no-unknown-classes': ['error', { ignore: ['^toaster$'] }],
    },
  },
  {
    // AGENTS.md §4: interactive elements come from components/ui (shadcn), never raw HTML.
    files: ['src/web/**/*.tsx'],
    ignores: ['src/web/components/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name=/^(button|input|select|option|textarea|dialog)$/]',
          message: 'Use the shadcn component from @/components/ui instead of a raw HTML control (AGENTS.md §4).',
        },
      ],
    },
  },
];
