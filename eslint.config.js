import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import pluginA11y from 'eslint-plugin-vuejs-accessibility'
import globals from 'globals'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  ...pluginA11y.configs['flat/recommended'],
  {
    files: ['src/**/*.{js,ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      // Relax template formatting rules — existing code uses compact style
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/attributes-order': 'off',
      'vue/html-self-closing': ['warn', {
        html: { void: 'always', normal: 'never', component: 'always' },
      }],
      // Keep meaningful code quality rules
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'vue/no-v-html': 'warn',
      // Accessibility: rules at warn to catch issues without breaking CI (LIFT-93)
      // Disabled: click-events-have-key-events, no-static-element-interactions — mobile-first
      // PWA uses divs as touch/gesture targets extensively; these are false positives
      'vuejs-accessibility/alt-text': 'warn',
      'vuejs-accessibility/anchor-has-content': 'warn',
      'vuejs-accessibility/aria-props': 'warn',
      'vuejs-accessibility/aria-role': 'warn',
      'vuejs-accessibility/aria-unsupported-elements': 'warn',
      'vuejs-accessibility/click-events-have-key-events': 'off',
      'vuejs-accessibility/form-control-has-label': 'warn',
      'vuejs-accessibility/heading-has-content': 'warn',
      'vuejs-accessibility/iframe-has-title': 'warn',
      'vuejs-accessibility/interactive-supports-focus': 'warn',
      'vuejs-accessibility/label-has-for': ['warn', { required: { some: ['nesting', 'id'] } }],
      'vuejs-accessibility/media-has-caption': 'warn',
      'vuejs-accessibility/mouse-events-have-key-events': 'warn',
      'vuejs-accessibility/no-access-key': 'warn',
      'vuejs-accessibility/no-autofocus': 'warn',
      'vuejs-accessibility/no-distracting-elements': 'warn',
      'vuejs-accessibility/no-redundant-roles': 'warn',
      'vuejs-accessibility/no-static-element-interactions': 'off',
      'vuejs-accessibility/role-has-required-aria-props': 'warn',
      'vuejs-accessibility/tabindex-no-positive': 'warn',
    },
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['src/**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'scripts/'],
  },
]
