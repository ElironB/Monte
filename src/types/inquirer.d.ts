declare module '@inquirer/prompts' {
  export function checkbox<T = string>(config: {
    message: string;
    choices: Array<{
      name: string;
      value: T;
      description?: string;
      disabled?: boolean | string;
      checked?: boolean;
    }>;
    pageSize?: number;
    loop?: boolean;
    required?: boolean;
  }): Promise<T[]>;
}
