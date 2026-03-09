import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, KeyRound, UserX, UserCheck, Package } from 'lucide-react';
import { toast } from 'sonner';

interface ManagedUser {
  user_id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'ck_manager' | 'branch_manager';
  status: string;
  created_at: string;
  branch_id: string | null;
}

interface BranchOption {
  id: string;
  branch_name: string;
}

export default function UserManagement() {
  const { session } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState<ManagedUser | null>(null);
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role: 'ck_manager' as string, branch_id: '' });
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const callAdmin = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body,
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await callAdmin({ action: 'list_users' });
      setUsers(data.users || []);
    } catch (err: any) {
      toast.error('Failed to load users: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => {
    if (session) {
      fetchUsers();
      supabase.from('branches').select('id, branch_name').then(({ data }) => {
        setBranches(data || []);
      });
    }
  }, [session, fetchUsers]);

  const handleCreate = async () => {
    const errs: Record<string, string> = {};
    if (!newUser.full_name.trim()) errs.full_name = 'Name is required';
    if (!newUser.email.trim()) errs.email = 'Email is required';
    if (!newUser.password || newUser.password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (newUser.role === 'branch_manager' && !newUser.branch_id) errs.branch_id = 'Branch is required for Branch Manager';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      await callAdmin({ action: 'create', ...newUser, branch_id: newUser.role === 'branch_manager' ? newUser.branch_id : null });
      toast.success('User created successfully');
      setCreateOpen(false);
      setNewUser({ full_name: '', email: '', password: '', role: 'ck_manager', branch_id: '' });
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleToggleStatus = async (user: ManagedUser) => {
    const newStatus = user.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await callAdmin({ action: 'update_status', user_id: user.user_id, status: newStatus });
      toast.success(`User ${newStatus === 'Active' ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleChangeRole = async (user: ManagedUser, newRole: string) => {
    try {
      await callAdmin({ action: 'update_role', user_id: user.user_id, role: newRole });
      toast.success('Role updated');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    try {
      await callAdmin({ action: 'reset_password', user_id: resetOpen!.user_id, new_password: newPassword });
      toast.success('Password reset successfully');
      setResetOpen(null);
      setNewPassword('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">User Management</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage user accounts and roles</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No users found. Add your first user above.
                  </TableCell>
                </TableRow>
              ) : (
                users.map(u => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.full_name || '—'}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={val => handleChangeRole(u, val)}
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="ck_manager">CK Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.status === 'Active' ? 'default' : 'secondary'}>
                        {u.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setResetOpen(u); setNewPassword(''); }}
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleStatus(u)}
                        title={u.status === 'Active' ? 'Deactivate' : 'Activate'}
                      >
                        {u.status === 'Active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                value={newUser.full_name}
                onChange={e => setNewUser(p => ({ ...p, full_name: e.target.value }))}
                placeholder="John Doe"
              />
              {errors.full_name && <p className="text-sm text-destructive">{errors.full_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={newUser.email}
                onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                placeholder="john@company.com"
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <Input
                type="password"
                value={newUser.password}
                onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                placeholder="Min 6 characters"
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newUser.role} onValueChange={val => setNewUser(p => ({ ...p, role: val }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="ck_manager">CK Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetOpen} onOpenChange={open => !open && setResetOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password for {resetOpen?.full_name || resetOpen?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min 6 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(null)}>Cancel</Button>
            <Button onClick={handleResetPassword}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
