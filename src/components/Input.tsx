/**
 * src/components/Input.tsx
 *
 * Labelled text input with icon, focus state, error state,
 * and password visibility toggle.
 *
 * Uses forwardRef so callers can programmatically focus
 * the inner TextInput (e.g. "next" keyboard button).
 */

import React, { useState, forwardRef, useRef, useImperativeHandle } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  Pressable,
  TextInputProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme } from '../theme/colors';

interface InputProps extends TextInputProps {
  label: string;
  iconName: React.ComponentProps<typeof Feather>['name'];
  isPassword?: boolean;
  error?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(
  (
    {
      label,
      iconName,
      isPassword = false,
      error = false,
      style,
      ...rest
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(!isPassword);
    const inputRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => inputRef.current as TextInput);

    const handleWrapperPress = () => {
      inputRef.current?.focus();
    };

    return (
      <View style={styles.container}>
        <Text style={styles.label} onPress={handleWrapperPress}>{label}</Text>
        <Pressable
          onPress={handleWrapperPress}
          style={[
            styles.inputWrapper,
            isFocused && styles.inputWrapperFocused,
            error && styles.inputWrapperError,
          ]}
        >
          <Feather
            name={iconName}
            size={16}
            color={
              error
                ? theme.colors.errorText
                : isFocused
                ? theme.colors.inputBorderActive
                : theme.colors.inputIcon
            }
            style={styles.leftIcon}
          />

          <TextInput
            ref={inputRef}
            style={[styles.input, style]}
            placeholderTextColor={theme.colors.inputPlaceholder}
            secureTextEntry={isPassword && !passwordVisible}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoCapitalize="none"
            {...rest}
          />

          {isPassword && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setPasswordVisible(!passwordVisible)}
              style={styles.rightIconButton}
              hitSlop={8}
            >
              <Feather
                name={passwordVisible ? 'eye-off' : 'eye'}
                size={16}
                color={theme.colors.inputIcon}
              />
            </TouchableOpacity>
          )}
        </Pressable>
      </View>
    );
  }
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    width: '100%',
  },
  label: {
    fontSize: 9,
    fontWeight: 'bold',
    color: theme.colors.labelPurple,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  inputWrapperFocused: {
    borderColor: theme.colors.inputBorderActive,
    boxShadow: '0px 0px 8px rgba(168, 85, 247, 0.25)',
  },
  inputWrapperError: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  leftIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.colors.inputText,
    fontSize: 13,
    fontWeight: '500',
  },
  rightIconButton: {
    padding: 6,
  },
});
