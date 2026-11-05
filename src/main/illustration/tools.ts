export const illustrationDefinitions = [
  {name:'pet_illustration_create',description:'按用户的角色、姿势、场景要求创建独立插画项目并打开。只创建项目，不代表已经生成图片；用户在插画页选择参考和生成。',inputSchema:{type:'object',properties:{description:{type:'string',minLength:1,maxLength:12000}},required:['description'],additionalProperties:false}},
  {name:'pet_illustration_list',description:'查看已有插画项目名称和当前状态，不返回图片或服务凭据。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
];
