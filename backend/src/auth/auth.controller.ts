import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ConfirmMfaDto, ConfirmMfaEnrollmentDto, DisableMfaDto, StartMfaEnrollmentDto, VerifyMfaDto } from './dto/mfa.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { AcceptBeneficiaryInviteDto } from './dto/accept-beneficiary-invite.dto';
import { CreateStaffAccountDto } from './dto/admin-provision-account.dto';

// Security hardening (independent readiness review, P0-06) — a tighter,
// per-route limit than the app-wide default (100 req/60s, app.module.ts)
// for the handful of endpoints brute-force actually targets: credential
// guessing, OTP guessing, and reset-token enumeration. Configurable so the
// e2e suite (which logs several fixture users in in a single burst from
// one IP) can relax it without weakening the production default.
const BRUTE_FORCE_THROTTLE = {
  default: {
    limit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '5', 10),
    ttl: parseInt(process.env.AUTH_THROTTLE_TTL_MS ?? '60000', 10),
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Second step when login responds with `mfaRequired: true`. */
  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/verify')
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.authService.verifyMfaLogin(dto.mfaToken, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enroll')
  enrollMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.enrollMfa(user.id);
  }

  /** Mandatory-MFA login branch — a privileged user without MFA enabled
   * gets an `enrollmentToken` instead of real session tokens (see
   * AuthService.login). No JwtAuthGuard: there is no real session to
   * guard yet — the enrollmentToken itself, verified inside the service
   * (single-purpose, 5-minute TTL, same mechanism as mfa/verify), is the
   * only thing authorizing these two calls. */
  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/enrollment-required/start')
  startRequiredMfaEnrollment(@Body() dto: StartMfaEnrollmentDto) {
    return this.authService.enrollMfaWithToken(dto.enrollmentToken);
  }

  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/enrollment-required/confirm')
  confirmRequiredMfaEnrollment(@Body() dto: ConfirmMfaEnrollmentDto) {
    return this.authService.confirmMfaEnrollmentRequired(dto.enrollmentToken, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/confirm')
  confirmMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmMfaDto) {
    return this.authService.confirmMfa(user.id, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/disable')
  disableMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: DisableMfaDto) {
    return this.authService.disableMfa(user.id, dto.password);
  }

  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated — please sign in again.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /** "Who is a Beneficiary" (portal access) — claims a
   * ProfileService.inviteBeneficiary link, creating the Beneficiary's own
   * account and logging them straight in. No JwtAuthGuard: there is no
   * session yet — the invite token itself, verified inside the service,
   * is what authorizes this. */
  @Throttle(BRUTE_FORCE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('beneficiary-invite/accept')
  acceptBeneficiaryInvite(@Body() dto: AcceptBeneficiaryInviteDto) {
    return this.authService.acceptBeneficiaryInvite(dto.token, dto.email, dto.password);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
  }

  /** Security hardening (P0-06) "session revocation" — every device. */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logoutAll(user.id);
  }

  /** Section 5.7 "Admin Console" — self-service staff account creation.
   * Field agents/providers keep their own onboarding at /ops/agents,
   * /ops/providers; partner logins go through
   * POST /admin/partners/:partnerId/contacts instead (see
   * PartnersController), since they always need a Partner to attach to. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('admin/staff')
  createStaffAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStaffAccountDto) {
    return this.authService.adminProvisionAccount(user, dto.email, dto.role);
  }

  /** Security checklist — "Admin Access Audit": every privileged account,
   * at a glance, without raw Prisma/psql. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/staff')
  listStaffAccounts() {
    return this.authService.listStaffAccounts();
  }

  /** Security checklist — "Employee Offboarding": disable the account and
   * kill every active session immediately, not just at next token
   * expiry. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/staff/:id/deactivate')
  deactivateStaffAccount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.authService.deactivateStaffAccount(user, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/staff/:id/reactivate')
  reactivateStaffAccount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.authService.reactivateStaffAccount(user, id);
  }
}
