'use client';

import { useState } from 'react';
import {
    useForm,
    type Resolver,
    type UseFormRegisterReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, X, CheckCircle2, XCircle, Database, Lock, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { connectionsApi } from '../api/connections.api';
import { useCreateConnection } from '../hooks/useConnections';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { SshConnectionInput } from '../types';

const ENGINE_PORTS = { mysql: 3306, mariadb: 3306, postgres: 5432, redshift: 5439, sqlserver: 1433, snowflake: 443, oracle: 1521 } as const;

const schema = z
    .object({
        name: z.string().min(2, 'Name must be at least 2 characters'),
        engine: z.enum(['mysql', 'mariadb', 'postgres', 'redshift', 'sqlserver', 'snowflake', 'oracle']),
        host: z.string().min(1, 'Host is required'),
        port: z.number().min(1).max(65535),
        databaseName: z.string().min(1, 'Database name is required'),
        username: z.string().min(1, 'Username is required'),
        password: z.string().min(1, 'Password is required'),
        sslEnabled: z.boolean().optional(),
        sshEnabled: z.boolean().optional(),
        sshHost: z.string().optional(),
        sshPort: z.number().min(1).max(65535).optional(),
        sshUsername: z.string().optional(),
        sshAuthMethod: z.enum(['key', 'password']).optional(),
        sshPrivateKey: z.string().optional(),
        sshPassphrase: z.string().optional(),
        sshPassword: z.string().optional(),
    })
    .superRefine((val, ctx) => {
        if (!val.sshEnabled) return;
        if (!val.sshHost?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sshHost'], message: 'SSH host is required' });
        }
        if (!val.sshUsername?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sshUsername'], message: 'SSH user is required' });
        }
        if (val.sshAuthMethod === 'password') {
            if (!val.sshPassword?.trim()) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sshPassword'], message: 'SSH password is required' });
            }
        } else if (!val.sshPrivateKey?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sshPrivateKey'], message: 'Private key is required' });
        }
    });

type FormData = z.infer<typeof schema>;

/** Pull just the SSH payload the API expects out of the form values. */
function sshPayload(v: FormData): SshConnectionInput {
    if (!v.sshEnabled) return { sshEnabled: false };
    const usingKey = v.sshAuthMethod !== 'password';
    return {
        sshEnabled: true,
        sshHost: v.sshHost?.trim(),
        sshPort: v.sshPort ?? 22,
        sshUsername: v.sshUsername?.trim(),
        sshPrivateKey: usingKey ? v.sshPrivateKey : undefined,
        sshPassphrase: usingKey ? (v.sshPassphrase || undefined) : undefined,
        sshPassword: usingKey ? undefined : v.sshPassword,
    };
}

interface TestResult {
    success: boolean;
    message: string;
    latencyMs: number;
}

/** Password input with a show/hide eye toggle. */
function PasswordInput({
    registration,
    className,
    placeholder,
}: {
    registration: UseFormRegisterReturn;
    className?: string;
    placeholder?: string;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input
                {...registration}
                type={show ? 'text' : 'password'}
                placeholder={placeholder}
                className={cn(className, 'pr-10')}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
            >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
        </div>
    );
}

interface Props {
    onClose: () => void;
}

export function AddConnectionModal({ onClose }: Props) {
    const { currentWorkspace } = useWorkspaceStore();
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const createConnection = useCreateConnection();

    const {
        register,
        handleSubmit,
        getValues,
        watch,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema) as Resolver<FormData>,
        defaultValues: {
            engine: 'mysql',
            port: 3306,
            sslEnabled: false,
            sshEnabled: false,
            sshPort: 22,
            sshAuthMethod: 'key',
        },
    });

    const sshEnabled = watch('sshEnabled');
    const sshAuthMethod = watch('sshAuthMethod') ?? 'key';
    const engine = watch('engine') ?? 'mysql';

    // Switch the engine, and move the port to the new engine's default if it was
    // still on the previous engine's default (don't clobber a custom port).
    const handleEngineChange = (next: 'mysql' | 'mariadb' | 'postgres' | 'redshift' | 'sqlserver' | 'snowflake' | 'oracle') => {
        const current = getValues('port');
        if (current === ENGINE_PORTS[engine]) {
            setValue('port', ENGINE_PORTS[next]);
        }
        setValue('engine', next);
    };

    const handleTest = async () => {
        const values = getValues();
        if (!values.host || !values.databaseName || !values.username || !values.password) {
            return;
        }
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await connectionsApi.testNew(
                currentWorkspace?.id ?? '',
                {
                    engine: values.engine,
                    host: values.host,
                    port: values.port,
                    databaseName: values.databaseName,
                    username: values.username,
                    password: values.password,
                    sslEnabled: values.sslEnabled,
                    ...sshPayload(values),
                },
            );
            setTestResult(result);
        } catch {
            setTestResult({ success: false, message: 'Test failed', latencyMs: 0 });
        } finally {
            setIsTesting(false);
        }
    };

    const onSubmit = async (data: FormData) => {
        await createConnection.mutateAsync({
            name: data.name,
            engine: data.engine,
            host: data.host,
            port: data.port,
            databaseName: data.databaseName,
            username: data.username,
            password: data.password,
            sslEnabled: data.sslEnabled,
            ...sshPayload(data),
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                            <Database className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                            <h2 className="font-semibold">Add Database Connection</h2>
                            <p className="text-xs text-muted-foreground">Connect a database</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4 overflow-y-auto">
                    {/* Database engine */}
                    <div>
                        <label className="block text-sm font-medium mb-1.5">Database Engine</label>
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { value: 'mysql', label: 'MySQL' },
                                { value: 'mariadb', label: 'MariaDB' },
                                { value: 'postgres', label: 'PostgreSQL' },
                                { value: 'redshift', label: 'Redshift' },
                                { value: 'sqlserver', label: 'SQL Server' },
                                { value: 'snowflake', label: 'Snowflake' },
                                { value: 'oracle', label: 'Oracle' },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleEngineChange(opt.value)}
                                    className={cn(
                                        'py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors',
                                        engine === opt.value
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'border-border hover:bg-accent',
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {engine === 'snowflake' && (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                                Enter your Snowflake <span className="font-medium">account identifier</span> (e.g. <code>xy12345.us-east-1</code>) in the Host field; Port is ignored. Queries run on your user&apos;s default warehouse. Connect &amp; query only — import, audit and migration aren&apos;t available for Snowflake.
                            </p>
                        )}
                        {engine === 'oracle' && (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                                For <span className="font-medium">Database</span>, use the Oracle <span className="font-medium">service name</span> (e.g. <code>FREEPDB1</code>). Objects are read from the connecting user&apos;s schema.
                            </p>
                        )}
                    </div>

                    {/* Connection Name */}
                    <div>
                        <label className="block text-sm font-medium mb-1.5">
                            Connection Name
                        </label>
                        <input
                            {...register('name')}
                            placeholder="e.g. Production DB"
                            className={cn(
                                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                'placeholder:text-muted-foreground',
                                errors.name ? 'border-destructive' : 'border-border',
                            )}
                        />
                        {errors.name && (
                            <p className="text-destructive text-xs mt-1">{errors.name.message}</p>
                        )}
                    </div>

                    {/* Host + Port */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium mb-1.5">Host</label>
                            <input
                                {...register('host')}
                                placeholder="localhost or IP"
                                className={cn(
                                    'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                    'placeholder:text-muted-foreground',
                                    errors.host ? 'border-destructive' : 'border-border',
                                )}
                            />
                            {errors.host && (
                                <p className="text-destructive text-xs mt-1">{errors.host.message}</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1.5">Port</label>
                            <input
                                {...register('port', { valueAsNumber: true })}
                                type="number"
                                placeholder={String(ENGINE_PORTS[engine])}
                                className={cn(
                                    'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                    errors.port ? 'border-destructive' : 'border-border',
                                )}
                            />
                        </div>
                    </div>

                    {/* Database Name */}
                    <div>
                        <label className="block text-sm font-medium mb-1.5">
                            Database Name
                        </label>
                        <input
                            {...register('databaseName')}
                            placeholder="my_database"
                            className={cn(
                                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                'placeholder:text-muted-foreground',
                                errors.databaseName ? 'border-destructive' : 'border-border',
                            )}
                        />
                        {errors.databaseName && (
                            <p className="text-destructive text-xs mt-1">{errors.databaseName.message}</p>
                        )}
                    </div>

                    {/* Username + Password */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1.5">Username</label>
                            <input
                                {...register('username')}
                                placeholder="root"
                                className={cn(
                                    'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                    'placeholder:text-muted-foreground',
                                    errors.username ? 'border-destructive' : 'border-border',
                                )}
                            />
                            {errors.username && (
                                <p className="text-destructive text-xs mt-1">{errors.username.message}</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1.5">Password</label>
                            <PasswordInput
                                registration={register('password')}
                                placeholder="••••••••"
                                className={cn(
                                    'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                    errors.password ? 'border-destructive' : 'border-border',
                                )}
                            />
                            {errors.password && (
                                <p className="text-destructive text-xs mt-1">{errors.password.message}</p>
                            )}
                        </div>
                    </div>

                    {/* SSH Tunnel */}
                    <div className="rounded-lg border border-border">
                        <label className="flex items-center justify-between gap-3 p-3 cursor-pointer">
                            <span className="flex items-center gap-2 text-sm font-medium">
                                <Lock className="w-4 h-4 text-muted-foreground" />
                                Connect via SSH tunnel
                            </span>
                            <input
                                type="checkbox"
                                {...register('sshEnabled')}
                                className="h-4 w-4 accent-primary"
                            />
                        </label>

                        {sshEnabled && (
                            <div className="space-y-3 border-t border-border p-3">
                                <p className="text-xs text-muted-foreground">
                                    The database is reached through this SSH host (bastion/VPN gateway).
                                    Host &amp; port above are resolved from the SSH server.
                                </p>

                                {/* SSH host + port */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium mb-1.5">SSH Host</label>
                                        <input
                                            {...register('sshHost')}
                                            placeholder="bastion.example.com"
                                            className={cn(
                                                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                                'placeholder:text-muted-foreground',
                                                errors.sshHost ? 'border-destructive' : 'border-border',
                                            )}
                                        />
                                        {errors.sshHost && (
                                            <p className="text-destructive text-xs mt-1">{errors.sshHost.message}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5">SSH Port</label>
                                        <input
                                            {...register('sshPort', { valueAsNumber: true })}
                                            type="number"
                                            placeholder="22"
                                            className={cn(
                                                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                                errors.sshPort ? 'border-destructive' : 'border-border',
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* SSH username */}
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">SSH Username</label>
                                    <input
                                        {...register('sshUsername')}
                                        placeholder="ec2-user"
                                        className={cn(
                                            'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                            'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                            'placeholder:text-muted-foreground',
                                            errors.sshUsername ? 'border-destructive' : 'border-border',
                                        )}
                                    />
                                    {errors.sshUsername && (
                                        <p className="text-destructive text-xs mt-1">{errors.sshUsername.message}</p>
                                    )}
                                </div>

                                {/* Auth method toggle */}
                                <div className="flex gap-2">
                                    {(['key', 'password'] as const).map((method) => (
                                        <button
                                            key={method}
                                            type="button"
                                            onClick={() => setValue('sshAuthMethod', method)}
                                            className={cn(
                                                'flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors',
                                                sshAuthMethod === method
                                                    ? 'bg-primary text-primary-foreground border-primary'
                                                    : 'border-border hover:bg-accent',
                                            )}
                                        >
                                            {method === 'key' ? 'Private Key' : 'Password'}
                                        </button>
                                    ))}
                                </div>

                                {sshAuthMethod === 'key' ? (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium mb-1.5">
                                                Private Key (PEM)
                                            </label>
                                            <textarea
                                                {...register('sshPrivateKey')}
                                                rows={4}
                                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                                className={cn(
                                                    'w-full px-3 py-2 bg-input border rounded-lg text-xs font-mono',
                                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                                    'placeholder:text-muted-foreground resize-none',
                                                    errors.sshPrivateKey ? 'border-destructive' : 'border-border',
                                                )}
                                            />
                                            {errors.sshPrivateKey && (
                                                <p className="text-destructive text-xs mt-1">{errors.sshPrivateKey.message}</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1.5">
                                                Key Passphrase <span className="text-muted-foreground font-normal">(optional)</span>
                                            </label>
                                            <PasswordInput
                                                registration={register('sshPassphrase')}
                                                placeholder="••••••••"
                                                className={cn(
                                                    'w-full px-3 py-2 bg-input border border-border rounded-lg text-sm',
                                                    'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                                )}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5">SSH Password</label>
                                        <PasswordInput
                                            registration={register('sshPassword')}
                                            placeholder="••••••••"
                                            className={cn(
                                                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                                errors.sshPassword ? 'border-destructive' : 'border-border',
                                            )}
                                        />
                                        {errors.sshPassword && (
                                            <p className="text-destructive text-xs mt-1">{errors.sshPassword.message}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div className={cn(
                            'flex items-center gap-2 p-3 rounded-lg text-sm border',
                            testResult.success
                                ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                                : 'bg-destructive/10 border-destructive/20 text-destructive',
                        )}>
                            {testResult.success
                                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                                : <XCircle className="w-4 h-4 shrink-0" />
                            }
                            <span>{testResult.message}</span>
                            {testResult.success && (
                                <span className="ml-auto text-xs opacity-70">{testResult.latencyMs}ms</span>
                            )}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={isTesting}
                            className={cn(
                                'flex-1 py-2 px-4 border border-border rounded-lg text-sm font-medium',
                                'hover:bg-accent transition-colors',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                'flex items-center justify-center gap-2',
                            )}
                        >
                            {isTesting && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isTesting ? 'Testing...' : 'Test Connection'}
                        </button>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={cn(
                                'flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-lg',
                                'text-sm font-medium hover:bg-primary/90 transition-colors',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                'flex items-center justify-center gap-2',
                            )}
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isSubmitting ? 'Saving...' : 'Save Connection'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}