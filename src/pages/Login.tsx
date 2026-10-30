import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChefHat, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

/** Supabase answers in English: the common ones in Thai, the rest as they come */
export function thaiAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'อีเมลหรือรหัสผ่านไม่ถูก';
  if (/email not confirmed/i.test(msg)) return 'อีเมลนี้ยังไม่ได้ยืนยัน';
  if (/rate limit|too many/i.test(msg)) return 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่';
  if (/network|fetch/i.test(msg)) return 'เชื่อมต่อไม่ได้ เช็คอินเทอร์เน็ตแล้วลองใหม่';
  return msg;
}

export default function Login() {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('ใส่อีเมลและรหัสผ่านก่อน');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error(thaiAuthError(error));
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('ใส่อีเมลก่อน');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);
    if (error) {
      toast.error(thaiAuthError(error));
    } else {
      toast.success('ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลแล้ว');
      setForgotMode(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border shadow-lg">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-14 h-14 rounded-xl flex items-center justify-center shadow-sm bg-[#ff5e29]">
            <ChefHat className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-page-title">Live to Eat</CardTitle>
            <p className="text-helper text-muted-foreground mt-1">ครัวกลางและสาขา</p>
            <CardDescription className="mt-3">
              {forgotMode ? 'ใส่อีเมล แล้วเราจะส่งลิงก์ตั้งรหัสใหม่ให้' : 'เข้าสู่ระบบ'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {forgotMode ?
          <form onSubmit={handleForgotPassword} className="space-y-field">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-helper font-medium">อีเมล</Label>
                <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ชื่อ@livetoeat.live"
                autoComplete="email"
                className="h-12 text-base" />
              
              </div>
              <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                {loading ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสใหม่'}
              </Button>
              <Button
              type="button"
              variant="link"
              className="w-full text-muted-foreground"
              onClick={() => setForgotMode(false)}>
              
                กลับไปหน้าเข้าสู่ระบบ
              </Button>
            </form> :

          <form onSubmit={handleLogin} className="space-y-field">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-helper font-medium">อีเมล</Label>
                <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ชื่อ@livetoeat.live"
                autoComplete="email"
                className="h-12 text-base" />
              
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-helper font-medium">รหัสผ่าน</Label>
                <div className="relative">
                  <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="h-12 pr-10 text-base" />
                
                  <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'ดูรหัสผ่าน'}
                  onClick={() => setShowPassword(!showPassword)}>
                  
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                {loading ? 'กำลังเข้าระบบ…' : 'เข้าสู่ระบบ'}
              </Button>
              <Button
              type="button"
              variant="link"
              className="w-full text-muted-foreground"
              onClick={() => setForgotMode(true)}>
              
                ลืมรหัสผ่าน
              </Button>
            </form>
          }
        </CardContent>
      </Card>
    </div>);

}