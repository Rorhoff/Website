export const GENDER_OPTIONS = [
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
] as const;

export const LOOKING_FOR_OPTIONS = [
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'nonbinary', label: 'Non-binary people' },
] as const;

export type Gender = (typeof GENDER_OPTIONS)[number]['value'];
export type LookingFor = (typeof LOOKING_FOR_OPTIONS)[number]['value'];

export function genderLabel(value: string): string {
  return GENDER_OPTIONS.find(o => o.value === value)?.label ?? value;
}

export function lookingForLabel(value: string): string {
  return LOOKING_FOR_OPTIONS.find(o => o.value === value)?.label ?? value;
}
