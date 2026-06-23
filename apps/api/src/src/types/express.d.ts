declare namespace Express {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
      createdAt: Date;
    };
    workspaceMember?: {
      role: string;
    };
  }
}
