declare module "node-windows" {
  export class Service {
    constructor(options: {
      name: string;
      description: string;
      script: string;
      workingDirectory: string;
      env: Array<{ name: string; value: string }>;
    });

    on(
      event: "install" | "alreadyinstalled" | "start" | "error",
      listener: (value?: unknown) => void
    ): void;

    install(): void;
  }
}
