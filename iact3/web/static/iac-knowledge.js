/**
 * iact3 IaC Knowledge Base
 * Extracted and condensed from aliyun/iac-code (https://github.com/aliyun/iac-code)
 * Provides professional ROS/Terraform template knowledge to the AI assistant.
 */
(function () {
    'use strict';

    // ROS 常用资源类型速查
    const ROS_RESOURCES = `
## ROS 常用资源类型
- ALIYUN::ECS::VPC: 专有网络
- ALIYUN::ECS::VSwitch: 交换机
- ALIYUN::ECS::SecurityGroup: 安全组（支持安全组规则）
- ALIYUN::ECS::InstanceGroup: ECS实例组（MaxAmount指定数量）
- ALIYUN::ECS::RunCommand: 在实例中执行自定义Shell命令（Sync: true同步执行）
- ALIYUN::ECS::Invocation: 执行公共命令（CommandName指定）
- ALIYUN::RDS::DBInstance: RDS数据库实例
- ALIYUN::Redis::Instance: Redis实例
- ALIYUN::OSS::Bucket: OSS存储桶
- ALIYUN::ROS::Stack: 嵌套栈`;

    // ECS 选型推荐表（精简版）
    const ECS_SELECTION = `
## ECS 实例选型推荐
| 场景 | 成本优先 | 性价比优先 | 性能优先 | 云盘 |
|------|----------|------------|----------|------|
| 个人网站/小程序 | 2c2g | 2c4g | 4c8g | ESSD PL0 |
| 企业官网/后端服务 | 2c4g | 4c8g | 8c16g | ESSD AutoPL |
| 开发测试环境 | 1c2g | 2c4g | 4c8g | ESSD PL0 |
| 数据库(MySQL/PG) | 4c16g | 8c32g | 16c64g | ESSD AutoPL |
| Redis/Memcached | 2c16g | 4c32g | 8c64g | ESSD AutoPL |
| AI模型推理 | 4c16g | 8c32g | 16c64g | ESSD AutoPL |
规格族: 个人e实例; 性价比u1/u2a; 性能g9i/c9i/r9i
镜像推荐: Alibaba Cloud Linux 4 > Ubuntu 24.04 > CentOS Stream 9`;

    // 模板参数规范
    const PARAM_SPEC = `
## ROS 模板参数规范
库存相关参数(ZoneId/InstanceType/ImageId/SystemDiskCategory等)不设Default，通过AssociationProperty让控制台自动关联候选值。
常用AssociationProperty:
- ECS可用区: ALIYUN::ECS::ZoneId (Metadata: RegionId)
- ECS实例规格: ALIYUN::ECS::Instance::InstanceType (Metadata: ZoneId, InstanceChargeType)
- ECS镜像: ALIYUN::ECS::Image::ImageId (Metadata: RegionId, InstanceType)
- 系统盘类型: ALIYUN::ECS::Disk::SystemDiskCategory (Metadata: ZoneId, InstanceType)
- VPC: ALIYUN::ECS::VPC::VPCId (Metadata: RegionId)
- 交换机: ALIYUN::VPC::VSwitch::VSwitchId (Metadata: ZoneId, VpcId)
参数间联动用 AssociationPropertyMetadata: ${ParamName} 引用其他参数`;

    // 安全组最佳实践
    const SECURITY = `
## 安全组最佳实践
- 默认不开22/3389端口，通过RunCommand部署应用
- Web服务只开80/443，SourceCidrIp: 0.0.0.0/0
- 层间通信用SourceGroupId引用上层安全组
- 须开SSH时，SourceCidrIp必须限定IP（如x.x.x.x/32），严禁0.0.0.0/0
- 分层安全组: 公网层(80/443) → 应用层(SourceGroupId) → 数据层(SourceGroupId)`;

    // VPC 网络规划
    const VPC_PLANNING = `
## VPC 网络规划
推荐CIDR: 10.0.0.0/16(生产) / 192.168.0.0/24(小项目)
VSwitch按可用区分开，每可用区按用途分层:
  公网层(SLB/NAT) → 应用层(ECS) → 数据层(RDS/Redis)
数据层(RDS/Redis)仅内网访问，不出公网
ECS无公网IP时通过NAT网关SNAT访问公网`;

    // ROS 模板函数速查
    const ROS_FUNCTIONS = `
## ROS 常用函数
- !Ref: 引用参数或资源
- !GetAtt: 获取资源属性 (如 !GetAtt MyEcs.PrivateIp)
- !Sub: 字符串变量替换 (${VarName})
- !Join: 连接字符串列表
- !Select: 从列表按索引选取
- Outputs中应用链接用Console.前缀，在ROS控制台概览页展示`;

    // Terraform 关键规范
    const TERRAFORM_SPEC = `
## Terraform 模板规范
变量名蛇形命名(instance_type)，资源名体现用途(alicloud_instance.web)
使用data source查询动态信息(可用区、镜像)，避免硬编码
库存相关变量须参数化: zone_id, instance_type, image_id, system_disk_category
与ROS集成: 通过tf2ros打包为ROS Terraform类型模板后部署`;

    // 模板生成流程
    const TEMPLATE_FLOW = `
## 模板生成与测试流程
1. 分析需求，确定资源列表
2. 查阅选型指南确定规格
3. 生成模板(库存属性参数化)
4. 在Playground页面加载模板 → 选地域 → Auto Generate → Run Test
5. 库存相关参数不写死，通过Auto Generate自动查询`;

    // 组合完整知识库
    const IAC_KNOWLEDGE = {
        rosResources: ROS_RESOURCES,
        ecsSelection: ECS_SELECTION,
        paramSpec: PARAM_SPEC,
        security: SECURITY,
        vpcPlanning: VPC_PLANNING,
        rosFunctions: ROS_FUNCTIONS,
        terraformSpec: TERRAFORM_SPEC,
        templateFlow: TEMPLATE_FLOW,

        // 获取完整知识文本（用于注入 system prompt）
        getFullKnowledge: function () {
            return [ROS_RESOURCES, ECS_SELECTION, PARAM_SPEC, SECURITY,
                    VPC_PLANNING, ROS_FUNCTIONS, TERRAFORM_SPEC, TEMPLATE_FLOW].join('\n');
        },

        // 获取精简版知识（控制 token 数量）
        getCompactKnowledge: function () {
            return [ROS_RESOURCES, ECS_SELECTION, PARAM_SPEC, SECURITY,
                    TEMPLATE_FLOW].join('\n');
        }
    };

    // Export to global scope
    window.IAC_KNOWLEDGE = IAC_KNOWLEDGE;
})();
