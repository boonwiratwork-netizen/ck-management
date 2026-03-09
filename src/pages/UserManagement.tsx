import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, AppRole } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, KeyRound, UserX, UserCheck, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';

interface ManagedUser {
  user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: string;
  created_at: string;
  branch_id: string | null;
  brand_assignments?: string[];
}

interface BranchOption {
  id: string;
  branch_name: string;
  brand_name: string;
}

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'management', label: 'Management' },
  { value: 'ck_manager', label: 'CK Manager' },
  { value: 'store_manager', label: 'Store Manager' },
  { value: 'area_manager', label: 'Area Manager' },
];

const roleBadgeColors: Record<AppRole, string> = {
  management: 'bg-gray-800 text-white',
  ck_manager: 'bg-orange-500 text-white',
  store_manager: 'bg-blue-500 text-white',
  area_manager: 'bg-purple-500 text-white',
};

export default function UserManagement() {
  const { session } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState<ManagedUser | null>(null);
  const [newUser, setNewUser] = useState({
    full_name: '', email: '', password: '',
    role: 'ck_manager' as AppRole,
    branch_id: '',
    brands: [] as string[],
  });
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);

  const callAdmin = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await callAdmin({ action: 'list_users' });
      // Fetch brand assignments for all users
      const { data: allBrands } = await supabase.from('user_brand_assignments').select('*');
      const usersWithBrands = (data.users || []).map((u: any) => ({
        ...u,
        // Map old role names
        role: u.role === 'admin' ? 'management' : u.role === 'branch_manager' ? 'store_manager' : u.role,
        brand_assignments: (allBrands || []).filter((b: any) => b.user_id === u.user_id).map((b: any) => b.brand),
      }));
      setUsers(usersWithBrands);
    } catch (err: any) {
      toast.error('Failed to load users: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => {
    if (session) {
      fetchUsers();
      supabase.from('branches').select('id, branch_name, brand_name').then(({ data }) => {
        setBranches(data || []);
        const brands = [...new Set((data || []).map(b => b.brand_name).filter(Boolean))];
        setAvailableBrands(brands);
      });
    }
  }, [session, fetchUsers]);

  const handleCreate = async () => {
    const errs: Record<string, string> = {};
    if (!newUser.full_name.trim()) errs.full_name = 'Name is required';
    if (!newUser.email.trim()) errs.email = 'Email is required';
    if (!newUser.password || newUser.password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (newUser.role === 'store_manager' && !newUser.branch_id) errs.branch_id = 'Branch is required for Store Manager';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      const result = await callAdmin({
        action: 'create',
        email: newUser.email,
        password: newUser.password,
        full_name: newUser.full_name,
        role: newUser.role,
        branch_id: newUser.role === 'store_manager' ? newUser.branch_id : null,
      });

      // If area_manager, create brand assignments
      if (newUser.role === 'area_manager' && result.user?.id) {
        const brandsToAssign = newUser.brands.length > 0 ? newUser.brands : availableBrands;
        for (const brand of brandsToAssign) {
          await supabase.from('user_brand_assignments').insert({
            user_id: result.user.id,
            brand,
          });
        }
      }

      toast.success('User created successfully');
      setCreateOpen(false);
      setNewUser({ full_name: '', email: '', password: '', role: 'ck_manager', branch_id: '', brands: [] });
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

  const getAssignmentDisplay = (user: ManagedUser) => {
    if (user.role === 'store_manager' && user.branch_id) {
      const branch = branches.find(b => b.id === user.branch_id);
      return branch?.branch_name || '—';
    }
    if (user.role === 'area_manager') {
      if (!user.brand_assignments || user.brand_assignments.length === 0) return 'All';
      return user.brand_assignments.join(', ');
    }
    return '—';
  };

  const toggleBrand = (brand: string) => {
    setNewUser(p => ({
      ...p,
      brands: p.brands.includes(brand)
        ? p.brands.filter(b => b !== brand)
        : [...p.brands, brand],
    }));
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
                <TableHead>Assignment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                        <SelectTrigger className="w-[150px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {getAssignmentDisplay(u)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.status === 'Active' ? 'default' : 'secondary'}>
                        {u.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => { setResetOpen(u); setNewPassword(''); }}
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
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
              <Select value={newUser.role} onValueChange={val => setNewUser(p => ({
                ...p, role: val as AppRole,
                branch_id: val === 'store_manager' ? p.branch_id : '',
                brands: val === 'area_manager' ? p.brands : [],
              }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newUser.role === 'store_manager' && (
              <div className="space-y-2">
                <Label>Branch *</Label>
                <Select value={newUser.branch_id} onValueChange={val => setNewUser(p => ({ ...p, branch_id: val }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.branch_id && <p className="text-sm text-destructive">{errors.branch_id}</p>}
              </div>
            )}
            {newUser.role === 'area_manager' && (
              <div className="space-y-2">
                <Label>Brand Access</Label>
                <p className="text-xs text-muted-foreground">Select brands this user can access. Leave empty for all brands.</p>
                <div className="space-y-2 mt-2">
                  {availableBrands.map(brand => (
                    <label key={brand} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={newUser.brands.includes(brand)}
                        onCheckedChange={() => toggleBrand(brand)}
                      />
                      <span className="text-sm">{brand}</span>
                    </label>
                  ))}
                  {availableBrands.length === 0 && (
                    <p className="text-xs text-muted-foreground">No brands found. Add branches with brand names first.</p>
                  )}
                </div>
              </div>
            )}
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
